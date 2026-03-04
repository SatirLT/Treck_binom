const express = require('express');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const config = require('./config');
const db = require('./database');
const binom = require('./binom');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve landing page
app.use('/landing', express.static(path.join(__dirname, '..', '..', 'landing')));

// Trust proxy for correct IP detection
app.set('trust proxy', true);

// CORS for landing page requests
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

/**
 * GET /click
 *
 * Точка входа. Пользователь приходит с рекламы.
 * 1. Сохраняем IP, User-Agent
 * 2. Генерируем click_id
 * 3. Регистрируем клик в Binom
 * 4. Редирект на лендинг (где сгенерируется client_hash)
 */
app.get('/click', async (req, res) => {
  try {
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'] || '';
    const referer = req.headers['referer'] || req.query.ref || '';

    // Собираем sub-параметры из query string
    const subParams = {};
    for (let i = 1; i <= 15; i++) {
      const key = `sub${i}`;
      if (req.query[key]) subParams[key] = req.query[key];
    }
    ['clickid', 'campaign_id', 'source', 'creative_id', 'adset_id'].forEach(key => {
      if (req.query[key]) subParams[key] = req.query[key];
    });

    const clickId = uuidv4();

    // Регистрируем клик в Binom (async, не блокируем редирект)
    const binomClickIdPromise = binom.registerClick({
      ip,
      userAgent,
      referer,
      subParams,
    });

    // Сохраняем клик в локальную БД
    // client_hash пока null — обновится когда лендинг пришлёт данные
    db.insertClick.run({
      click_id: clickId,
      binom_click_id: null,
      client_hash: null,
      ip,
      user_agent: userAgent,
      referer,
      sub_params: JSON.stringify(subParams),
    });

    // Обновляем binom_click_id когда Binom ответит
    binomClickIdPromise.then(binomClickId => {
      if (binomClickId) {
        db.db.prepare('UPDATE clicks SET binom_click_id = ? WHERE click_id = ?')
          .run(binomClickId, clickId);
      }
    }).catch(() => {});

    // Редирект на лендинг с click_id
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
 * Вызывается JS-скриптом лендинга.
 * Лендинг генерирует client_hash на стороне клиента и отправляет сюда.
 * Сервер сохраняет client_hash привязанным к click_id.
 */
app.post('/click/fingerprint', (req, res) => {
  try {
    const { click_id, client_hash, screen_width, screen_height, language, timezone } = req.body;

    if (!click_id) {
      return res.status(400).json({ error: 'click_id required' });
    }

    const click = db.findClickById.get({ click_id });
    if (!click) {
      return res.status(404).json({ error: 'Click not found' });
    }

    // Сохраняем client_hash и параметры устройства
    db.db.prepare(`
      UPDATE clicks
      SET client_hash = ?, screen_width = ?, screen_height = ?, language = ?, timezone = ?
      WHERE click_id = ?
    `).run(
      client_hash || null,
      screen_width || null,
      screen_height || null,
      language || null,
      timezone || null,
      click_id
    );

    console.log(`Fingerprint saved: click=${click_id}, hash=${client_hash}`);
    res.json({ status: 'ok', client_hash });
  } catch (error) {
    console.error('Fingerprint update error:', error);
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * POST /install
 *
 * Вызывается iOS SDK при первом запуске приложения.
 *
 * МНОГОСТУПЕНЧАТЫЙ МАТЧИНГ:
 *
 * Ступень 1: click_id (точность ~99%)
 *   Если iOS SDK достал click_id из буфера обмена — ищем по нему.
 *
 * Ступень 2: client_hash (точность ~95%)
 *   Хэш, сгенерированный на лендинге = хэш, сгенерированный в iOS SDK.
 *   Параметры: screenW + screenH + language + timezone
 *
 * Ступень 3: IP + экран + язык + таймзона (точность ~85%)
 *   Если хэш не найден (лендинг не успел отправить) — ищем по сырым параметрам.
 *
 * Ступень 4: IP + экран (точность ~70%)
 *   Менее точный fallback.
 *
 * Ступень 5: Только IP (точность ~40%)
 *   Последний шанс. Много ложных срабатываний, но лучше чем ничего.
 */
app.post('/install', async (req, res) => {
  try {
    const {
      click_id,       // Из буфера обмена (если удалось достать)
      client_hash,    // Хэш устройства (сгенерирован в iOS SDK)
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

    let matchedClick = null;
    let matchMethod = 'none';

    // === СТУПЕНЬ 1: Прямой click_id (самый точный) ===
    if (click_id) {
      matchedClick = db.findClickById.get({ click_id });
      if (matchedClick) {
        matchMethod = 'click_id';
        console.log(`Match by click_id: ${click_id}`);
      }
    }

    // === СТУПЕНЬ 2: client_hash (хэш с лендинга = хэш из приложения) ===
    if (!matchedClick && client_hash) {
      matchedClick = db.findClickByClientHash.get({ client_hash });
      if (matchedClick) {
        matchMethod = 'client_hash';
        console.log(`Match by client_hash: ${client_hash} → click=${matchedClick.click_id}`);
      }
    }

    // === СТУПЕНЬ 3: IP + все параметры экрана ===
    if (!matchedClick && ip && screen_width && screen_height && language && timezone) {
      matchedClick = db.findClickByIpAndParams.get({
        ip,
        screen_width,
        screen_height,
        language,
        timezone,
      });
      if (matchedClick) {
        matchMethod = 'ip_and_params';
        console.log(`Match by IP+params: ${ip}, ${screen_width}x${screen_height} → click=${matchedClick.click_id}`);
      }
    }

    // === СТУПЕНЬ 4: IP + разрешение экрана ===
    if (!matchedClick && ip && screen_width && screen_height) {
      matchedClick = db.findClickByIpAndScreen.get({
        ip,
        screen_width,
        screen_height,
      });
      if (matchedClick) {
        matchMethod = 'ip_and_screen';
        console.log(`Match by IP+screen: ${ip}, ${screen_width}x${screen_height} → click=${matchedClick.click_id}`);
      }
    }

    // === СТУПЕНЬ 5: Только IP (последний шанс) ===
    if (!matchedClick && ip) {
      matchedClick = db.findClickByIp.get({ ip });
      if (matchedClick) {
        matchMethod = 'ip_only';
        console.log(`Match by IP only: ${ip} → click=${matchedClick.click_id} (low confidence)`);
      }
    }

    if (!matchedClick) {
      console.log(`No match found: hash=${client_hash}, ip=${ip}, screen=${screen_width}x${screen_height}`);
    }

    // Сохраняем запись об установке
    const installData = {
      click_id: click_id || null,
      client_hash: client_hash || null,
      device_id: device_id || null,
      idfa: idfa || null,
      idfv: idfv || null,
      bundle_id: bundle_id || null,
      app_version: app_version || null,
      os_version: os_version || null,
      device_model: device_model || null,
      screen_width: screen_width || null,
      screen_height: screen_height || null,
      language: language || null,
      timezone: timezone || null,
      ip,
      matched_click_id: matchedClick ? matchedClick.click_id : null,
      match_method: matchMethod,
    };

    const result = db.insertInstall.run(installData);

    // Отправляем постбек в Binom, если матч найден
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
 * Трекинг in-app событий (регистрация, покупка и т.д.)
 */
app.post('/event', async (req, res) => {
  try {
    const { device_id, idfv, event_name, event_value, payout } = req.body;

    if (!event_name) {
      return res.status(400).json({ error: 'event_name required' });
    }

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
 * GET /stats — Статистика за сегодня
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

    // Статистика по методам матчинга
    const methods = db.db.prepare(`
      SELECT match_method, COUNT(*) as count FROM installs
      WHERE date(created_at) = ? AND match_method != 'none'
      GROUP BY match_method
    `).all(today);

    res.json({
      date: today,
      clicks: clicks.count,
      installs: installs.count,
      matched: matched.count,
      postbacks_sent: postbacks.count,
      match_rate: installs.count > 0
        ? ((matched.count / installs.count) * 100).toFixed(1) + '%'
        : '0%',
      match_methods: methods.reduce((acc, m) => {
        acc[m.match_method] = m.count;
        return acc;
      }, {}),
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
