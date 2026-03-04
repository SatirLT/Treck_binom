const express = require('express');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const config = require('./config');
const db = require('./database');
const binom = require('./binom');
const { generateFingerprint, generateServerFingerprint } = require('./fingerprint');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve landing page
app.use('/landing', express.static(path.join(__dirname, '..', '..', 'landing')));

// Trust proxy for correct IP detection
app.set('trust proxy', true);

/**
 * GET /click
 *
 * Main entry point. User arrives from ad network.
 * 1. Generate fingerprint from request data
 * 2. Register click in Binom
 * 3. Save click locally
 * 4. Redirect to landing page
 */
app.get('/click', async (req, res) => {
  try {
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'] || '';
    const referer = req.headers['referer'] || req.query.ref || '';

    // Collect sub parameters from query string
    const subParams = {};
    for (let i = 1; i <= 15; i++) {
      const key = `sub${i}`;
      if (req.query[key]) subParams[key] = req.query[key];
    }
    // Also support common tokens
    ['clickid', 'campaign_id', 'source', 'creative_id', 'adset_id'].forEach(key => {
      if (req.query[key]) subParams[key] = req.query[key];
    });

    const fingerprint = generateServerFingerprint({ ip, userAgent });
    const clickId = uuidv4();

    // Register click in Binom (async, don't block redirect)
    const binomClickIdPromise = binom.registerClick({
      ip,
      userAgent,
      referer,
      subParams,
    });

    // Save click to local DB immediately
    db.insertClick.run({
      click_id: clickId,
      binom_click_id: null, // will update after Binom responds
      fingerprint,
      ip,
      user_agent: userAgent,
      referer,
      sub_params: JSON.stringify(subParams),
    });

    // Update binom_click_id when available
    binomClickIdPromise.then(binomClickId => {
      if (binomClickId) {
        db.db.prepare('UPDATE clicks SET binom_click_id = ? WHERE click_id = ?')
          .run(binomClickId, clickId);
      }
    }).catch(() => {});

    // Redirect to landing page with click_id
    const landingUrl = `${config.server.baseUrl}/landing/index.html?click_id=${clickId}`;
    res.redirect(302, landingUrl);
  } catch (error) {
    console.error('Click handler error:', error);
    res.status(500).send('Internal error');
  }
});

/**
 * POST /click/fingerprint
 *
 * Called from landing page JS to update fingerprint with client-side data.
 * This improves matching accuracy.
 */
app.post('/click/fingerprint', (req, res) => {
  try {
    const { click_id, screenWidth, screenHeight, language, timezone } = req.body;

    if (!click_id) {
      return res.status(400).json({ error: 'click_id required' });
    }

    const click = db.findClickById.get({ click_id });
    if (!click) {
      return res.status(404).json({ error: 'Click not found' });
    }

    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'] || '';

    // Generate enhanced fingerprint with client-side data
    const fingerprint = generateFingerprint({
      ip,
      userAgent,
      screenWidth,
      screenHeight,
      language,
      timezone,
    });

    // Update fingerprint in DB
    db.db.prepare('UPDATE clicks SET fingerprint = ? WHERE click_id = ?')
      .run(fingerprint, click_id);

    res.json({ status: 'ok', fingerprint });
  } catch (error) {
    console.error('Fingerprint update error:', error);
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * POST /install
 *
 * Called from iOS SDK when app is first launched.
 * 1. Collect device info
 * 2. Generate fingerprint
 * 3. Match to a click (fingerprint or click_id)
 * 4. Send postback to Binom
 */
app.post('/install', async (req, res) => {
  try {
    const {
      click_id,     // If passed from landing via clipboard/deep link
      device_id,
      idfa,
      idfv,
      bundle_id,
      app_version,
      os_version,
      device_model,
      screen_width,
      screen_height,
      language,
      timezone,
    } = req.body;

    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'] || '';

    let matchedClick = null;
    let matchMethod = 'none';

    // Method 1: Direct click_id match (most accurate)
    if (click_id) {
      matchedClick = db.findClickById.get({ click_id });
      if (matchedClick) {
        matchMethod = 'click_id';
      }
    }

    // Method 2: Fingerprint match (probabilistic)
    if (!matchedClick) {
      // Try enhanced fingerprint first
      const enhancedFP = generateFingerprint({
        ip,
        userAgent,
        screenWidth: screen_width,
        screenHeight: screen_height,
        language,
        timezone,
      });

      matchedClick = db.findClickByFingerprint.get({ fingerprint: enhancedFP });
      if (matchedClick) {
        matchMethod = 'fingerprint_enhanced';
      }
    }

    if (!matchedClick) {
      // Try server-side fingerprint
      const serverFP = generateServerFingerprint({ ip, userAgent });
      matchedClick = db.findClickByFingerprint.get({ fingerprint: serverFP });
      if (matchedClick) {
        matchMethod = 'fingerprint_server';
      }
    }

    // Save install record
    const installData = {
      click_id: click_id || null,
      device_id: device_id || null,
      idfa: idfa || null,
      idfv: idfv || null,
      bundle_id: bundle_id || null,
      app_version: app_version || null,
      os_version: os_version || null,
      device_model: device_model || null,
      fingerprint: generateServerFingerprint({ ip, userAgent }),
      ip,
      matched_click_id: matchedClick ? matchedClick.click_id : null,
      match_method: matchMethod,
    };

    const result = db.insertInstall.run(installData);

    // Send postback to Binom if matched
    let postbackSent = false;
    if (matchedClick && matchedClick.binom_click_id) {
      postbackSent = await binom.sendPostback({
        binomClickId: matchedClick.binom_click_id,
        status: 'install',
        payout: 0,
      });

      if (postbackSent) {
        db.markPostbackSent.run({ id: result.lastInsertRowid });
        db.updateClickStatus.run({ click_id: matchedClick.click_id, status: 'converted' });
      }
    }

    res.json({
      status: 'ok',
      matched: !!matchedClick,
      match_method: matchMethod,
      postback_sent: postbackSent,
    });
  } catch (error) {
    console.error('Install handler error:', error);
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * POST /event
 *
 * Track in-app events (registration, purchase, etc.)
 * and send event postbacks to Binom.
 */
app.post('/event', async (req, res) => {
  try {
    const { device_id, idfv, event_name, event_value, payout } = req.body;

    if (!event_name) {
      return res.status(400).json({ error: 'event_name required' });
    }

    // Find the install by device identifiers
    const install = db.db.prepare(`
      SELECT i.*, c.binom_click_id FROM installs i
      LEFT JOIN clicks c ON i.matched_click_id = c.click_id
      WHERE (i.device_id = ? OR i.idfv = ?)
      ORDER BY i.created_at DESC LIMIT 1
    `).get(device_id || '', idfv || '');

    if (!install || !install.binom_click_id) {
      return res.json({ status: 'ok', postback_sent: false, reason: 'no_matched_click' });
    }

    const postbackSent = await binom.sendPostback({
      binomClickId: install.binom_click_id,
      status: event_name,
      payout: payout || 0,
      eventName: event_name,
    });

    res.json({ status: 'ok', postback_sent: postbackSent });
  } catch (error) {
    console.error('Event handler error:', error);
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * GET /stats
 *
 * Simple stats endpoint for monitoring.
 */
app.get('/stats', (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const clicks = db.db.prepare(
      "SELECT COUNT(*) as count FROM clicks WHERE date(created_at) = ?"
    ).get(today);

    const installs = db.db.prepare(
      "SELECT COUNT(*) as count FROM installs WHERE date(created_at) = ?"
    ).get(today);

    const matched = db.db.prepare(
      "SELECT COUNT(*) as count FROM installs WHERE date(created_at) = ? AND matched_click_id IS NOT NULL"
    ).get(today);

    const postbacks = db.db.prepare(
      "SELECT COUNT(*) as count FROM installs WHERE date(created_at) = ? AND postback_sent = 1"
    ).get(today);

    res.json({
      date: today,
      clicks: clicks.count,
      installs: installs.count,
      matched: matched.count,
      postbacks_sent: postbacks.count,
      match_rate: installs.count > 0
        ? ((matched.count / installs.count) * 100).toFixed(1) + '%'
        : '0%',
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(config.server.port, () => {
  console.log(`Treck Binom server running on port ${config.server.port}`);
  console.log(`Landing page: ${config.server.baseUrl}/landing/index.html`);
  console.log(`Click URL: ${config.server.baseUrl}/click`);
});
