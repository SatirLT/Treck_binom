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

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// =====================================================================
// GET /click — Точка входа. Пользователь приходит с рекламы.
// =====================================================================
app.get('/click', async (req, res) => {
  try {
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'] || '';
    const referer = req.headers['referer'] || req.query.ref || '';

    // Собираем sub-параметры
    const subParams = {};
    for (let i = 1; i <= 15; i++) {
      const key = `sub${i}`;
      if (req.query[key]) subParams[key] = req.query[key];
    }
    ['clickid', 'campaign_id', 'source', 'creative_id', 'adset_id', 'ad_id', 'placement'].forEach(key => {
      if (req.query[key]) subParams[key] = req.query[key];
    });

    const clickId = uuidv4();

    // Регистрируем клик в Binom (async)
    const binomClickIdPromise = binom.registerClick({
      ip, userAgent, referer, subParams,
    });

    // Сохраняем клик в БД
    db.insertClick.run({
      click_id: clickId,
      binom_click_id: null,
      client_hash: null,
      ip,
      user_agent: userAgent,
      referer,
      sub_params: JSON.stringify(subParams),
    });

    // Обновляем binom_click_id
    binomClickIdPromise.then(binomClickId => {
      if (binomClickId) {
        db.db.prepare('UPDATE clicks SET binom_click_id = ? WHERE click_id = ?')
          .run(binomClickId, clickId);
      }
    }).catch(() => {});

    const landingUrl = `${config.server.baseUrl}/landing/index.html?click_id=${clickId}`;
    res.redirect(302, landingUrl);
  } catch (error) {
    console.error('Click handler error:', error);
    res.status(500).send('Internal error');
  }
});

// =====================================================================
// POST /click/fingerprint — Лендинг отправляет client_hash + параметры
// =====================================================================
app.post('/click/fingerprint', (req, res) => {
  try {
    const { click_id, client_hash, screen_width, screen_height, language, timezone, os_version, dpr } = req.body;

    if (!click_id) {
      return res.status(400).json({ error: 'click_id required' });
    }

    const click = db.findClickById.get({ click_id });
    if (!click) {
      return res.status(404).json({ error: 'Click not found' });
    }

    db.db.prepare(`
      UPDATE clicks
      SET client_hash = ?, screen_width = ?, screen_height = ?,
          language = ?, timezone = ?, os_version = ?, dpr = ?
      WHERE click_id = ?
    `).run(
      client_hash || null,
      screen_width || null,
      screen_height || null,
      language || null,
      timezone || null,
      os_version || null,
      dpr || null,
      click_id
    );

    console.log(`Fingerprint saved: click=${click_id}, hash=${client_hash}, os=${os_version}, dpr=${dpr}`);
    res.json({ status: 'ok', client_hash });
  } catch (error) {
    console.error('Fingerprint update error:', error);
    res.status(500).json({ error: 'Internal error' });
  }
});

// =====================================================================
// POST /install — iOS SDK регистрирует установку
//
// МНОГОСТУПЕНЧАТЫЙ МАТЧИНГ:
//   1. click_id (из clipboard)             — точность ~99%
//   2. client_hash (одинаковый хэш)        — точность ~95%
//   3. IP + экран + язык + TZ + OS version — точность ~90%
//   4. IP + экран + язык + TZ             — точность ~80%
//   5. IP + экран                          — точность ~65%
//   6. Только IP                           — точность ~35%
// =====================================================================
app.post('/install', async (req, res) => {
  try {
    const {
      click_id, client_hash,
      device_id, idfa, idfv,
      bundle_id, app_version, os_version, os_version_full,
      device_model, screen_width, screen_height, dpr,
      language, timezone,
    } = req.body;

    const ip = req.ip || req.connection.remoteAddress;

    let matchedClick = null;
    let matchMethod = 'none';

    // === СТУПЕНЬ 1: click_id ===
    if (!matchedClick && click_id) {
      matchedClick = db.findClickById.get({ click_id });
      if (matchedClick) {
        matchMethod = 'click_id';
        console.log(`[MATCH] click_id: ${click_id}`);
      }
    }

    // === СТУПЕНЬ 2: client_hash ===
    if (!matchedClick && client_hash) {
      matchedClick = db.findClickByClientHash.get({ client_hash });
      if (matchedClick) {
        matchMethod = 'client_hash';
        console.log(`[MATCH] client_hash: ${client_hash} → click=${matchedClick.click_id}`);
      }
    }

    // === СТУПЕНЬ 3: IP + экран + язык + TZ + OS ===
    if (!matchedClick && ip && screen_width && screen_height && language && timezone && os_version) {
      matchedClick = db.findClickByIpAndAllParams.get({
        ip, screen_width, screen_height, language, timezone, os_version,
      });
      if (matchedClick) {
        matchMethod = 'ip_screen_lang_tz_os';
        console.log(`[MATCH] IP+all params → click=${matchedClick.click_id}`);
      }
    }

    // === СТУПЕНЬ 4: IP + экран + язык + TZ ===
    if (!matchedClick && ip && screen_width && screen_height && language && timezone) {
      matchedClick = db.findClickByIpAndParams.get({
        ip, screen_width, screen_height, language, timezone,
      });
      if (matchedClick) {
        matchMethod = 'ip_screen_lang_tz';
        console.log(`[MATCH] IP+screen+lang+tz → click=${matchedClick.click_id}`);
      }
    }

    // === СТУПЕНЬ 5: IP + экран ===
    if (!matchedClick && ip && screen_width && screen_height) {
      matchedClick = db.findClickByIpAndScreen.get({
        ip, screen_width, screen_height,
      });
      if (matchedClick) {
        matchMethod = 'ip_screen';
        console.log(`[MATCH] IP+screen → click=${matchedClick.click_id}`);
      }
    }

    // === СТУПЕНЬ 6: Только IP ===
    if (!matchedClick && ip) {
      matchedClick = db.findClickByIp.get({ ip });
      if (matchedClick) {
        matchMethod = 'ip_only';
        console.log(`[MATCH] IP only → click=${matchedClick.click_id} (low confidence)`);
      }
    }

    if (!matchedClick) {
      console.log(`[NO MATCH] hash=${client_hash}, ip=${ip}, screen=${screen_width}x${screen_height}`);
    }

    // Определяем статус атрибуции
    const attributionStatus = matchedClick ? 'non-organic' : 'organic';

    // Сохраняем установку
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
      dpr: dpr || null,
      language: language || null,
      timezone: timezone || null,
      ip,
      matched_click_id: matchedClick ? matchedClick.click_id : null,
      match_method: matchMethod,
      attribution_status: attributionStatus,
    };

    const result = db.insertInstall.run(installData);

    // Постбек в Binom
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

    // Парсим campaign data из sub_params клика
    let campaignData = {};
    if (matchedClick && matchedClick.sub_params) {
      try { campaignData = JSON.parse(matchedClick.sub_params); } catch (e) {}
    }

    res.json({
      status: 'ok',
      // === Данные для iOS SDK ===
      attribution_status: attributionStatus,   // "non-organic" или "organic"
      matched: !!matchedClick,
      match_method: matchMethod,
      postback_sent: postbackSent,
      // Данные клика (для воронок в приложении)
      click_id: matchedClick ? matchedClick.click_id : null,
      binom_click_id: matchedClick ? matchedClick.binom_click_id : null,
      campaign_data: campaignData,
    });
  } catch (error) {
    console.error('Install handler error:', error);
    res.status(500).json({ error: 'Internal error' });
  }
});

// =====================================================================
// POST /status — Проверка статуса: Organic или Non-Organic
//
// Вызывается iOS SDK в любой момент. Быстрый ответ из БД.
// Приложение использует это для построения воронок:
//   non-organic → воронка для рекламного трафика
//   organic → стандартный онбординг
// =====================================================================
app.post('/status', (req, res) => {
  try {
    const { device_id, idfv, client_hash } = req.body;

    // Ищем установку по device_id или idfv
    let install = null;
    if (device_id || idfv) {
      install = db.findInstallByDevice.get({
        device_id: device_id || '',
        idfv: idfv || '',
      });
    }

    // Fallback: поиск по client_hash
    if (!install && client_hash) {
      install = db.findInstallByClientHash.get({ client_hash });
    }

    if (!install) {
      return res.json({
        status: 'organic',
        match_method: 'none',
        click_id: null,
        binom_click_id: null,
        campaign_data: {},
      });
    }

    // Парсим campaign data
    let campaignData = {};
    if (install.click_sub_params) {
      try { campaignData = JSON.parse(install.click_sub_params); } catch (e) {}
    }

    res.json({
      status: install.attribution_status || (install.matched_click_id ? 'non-organic' : 'organic'),
      match_method: install.match_method || 'none',
      click_id: install.matched_click_id || null,
      binom_click_id: install.binom_click_id || null,
      campaign_data: campaignData,
    });
  } catch (error) {
    console.error('Status handler error:', error);
    res.status(500).json({ error: 'Internal error' });
  }
});

// =====================================================================
// POST /event — Трекинг in-app событий
// =====================================================================
app.post('/event', async (req, res) => {
  try {
    const { device_id, idfv, event_name, event_value, payout } = req.body;

    if (!event_name) {
      return res.status(400).json({ error: 'event_name required' });
    }

    const install = db.findInstallByDevice.get({
      device_id: device_id || '',
      idfv: idfv || '',
    });

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

// =====================================================================
// POST /apphud/webhook — Приём событий покупок из Apphud
//
// Apphud Connection Builder шлёт сюда POST с данными о покупке.
// Мы извлекаем binom_click_id из user_properties и шлём постбек в Binom.
//
// Поток:
//   Покупка в App → Apphud обрабатывает → Connection Builder POST сюда
//   → Извлекаем binom_click_id → Постбек в Binom (purchase + revenue)
//
// Connection Builder шаблон (настраивается в Apphud Dashboard):
//   {
//     "event_id": "{{ event.id }}",
//     "event_name": "{{ event.name }}",
//     "product_id": "{{ event.receipt.product_id }}",
//     "price_usd": {{ event.receipt.price_usd | default: 0 }},
//     "proceeds_usd": {{ event.receipt.proceeds_usd | default: 0 }},
//     "currency": "{{ event.receipt.currency }}",
//     "transaction_id": "{{ event.receipt.transaction_id }}",
//     "original_transaction_id": "{{ event.receipt.original_transaction_id }}",
//     "user_id": "{{ user.user_id }}",
//     "binom_click_id": "{{ user.user_properties.binom_click_id }}",
//     "treck_click_id": "{{ user.user_properties.treck_click_id }}",
//     "attribution_status": "{{ user.user_properties.attribution_status }}",
//     "campaign_source": "{{ user.user_properties.campaign_source }}"
//   }
// =====================================================================
app.post('/apphud/webhook', async (req, res) => {
  try {
    // Проверяем секретный токен (если настроен)
    if (config.apphud.secretToken) {
      const token = req.headers['x-apphud-token'] || '';
      if (token !== config.apphud.secretToken) {
        console.warn('Apphud webhook: invalid token');
        return res.status(401).json({ error: 'Invalid token' });
      }
    }

    const {
      event_id, event_name,
      product_id, price_usd, proceeds_usd, currency,
      transaction_id, original_transaction_id,
      user_id,
      binom_click_id, treck_click_id,
      attribution_status,
    } = req.body;

    console.log(`[APPHUD] Event: ${event_name}, product=${product_id}, price=$${price_usd}, binom_click=${binom_click_id || 'none'}`);

    // Определяем binom_click_id (может прийти напрямую или через поиск по treck_click_id)
    let resolvedBinomClickId = binom_click_id || null;

    // Fallback: если binom_click_id не пришёл, ищем по treck_click_id
    if (!resolvedBinomClickId && treck_click_id) {
      const install = db.findInstallByClickId.get({ click_id: treck_click_id });
      if (install && install.binom_click_id) {
        resolvedBinomClickId = install.binom_click_id;
        console.log(`[APPHUD] Resolved binom_click_id via treck_click_id: ${resolvedBinomClickId}`);
      }
    }

    // Маппинг событий Apphud → статусы для Binom
    const eventMap = {
      'trial_started': { status: 'trial', payout: 0 },
      'trial_converted': { status: 'purchase', payout: null },
      'subscription_started': { status: 'purchase', payout: null },
      'subscription_renewed': { status: 'rebill', payout: null },
      'non_renewing_purchase': { status: 'purchase', payout: null },
      'subscription_refunded': { status: 'refund', payout: null },
      'trial_expired': { status: 'trial_expired', payout: 0 },
      'subscription_expired': { status: 'unsubscribe', payout: 0 },
      'subscription_canceled': { status: 'cancel', payout: 0 },
    };

    const mapped = eventMap[event_name] || { status: event_name, payout: null };
    // payout: proceeds (то, что получает разработчик после комиссии Apple)
    const payout = mapped.payout !== null ? mapped.payout : (proceeds_usd || price_usd || 0);

    // Сохраняем событие
    let postbackSent = false;
    const eventData = {
      apphud_event_id: event_id || null,
      event_name: event_name || 'unknown',
      product_id: product_id || null,
      price_usd: price_usd || 0,
      proceeds_usd: proceeds_usd || 0,
      currency: currency || 'USD',
      transaction_id: transaction_id || null,
      original_transaction_id: original_transaction_id || null,
      apphud_user_id: user_id || null,
      binom_click_id: resolvedBinomClickId,
      treck_click_id: treck_click_id || null,
      postback_sent: 0,
      raw_payload: JSON.stringify(req.body),
    };

    const result = db.insertApphudEvent.run(eventData);

    // Шлём постбек в Binom
    if (resolvedBinomClickId) {
      postbackSent = await binom.sendPostback({
        binomClickId: resolvedBinomClickId,
        status: mapped.status,
        payout,
        eventName: event_name,
      });

      if (postbackSent) {
        db.markApphudPostbackSent.run({ id: result.lastInsertRowid });
        console.log(`[APPHUD] Postback sent to Binom: click=${resolvedBinomClickId}, status=${mapped.status}, payout=${payout}`);
      }
    } else {
      console.log(`[APPHUD] No binom_click_id — event saved but no postback (organic user)`);
    }

    res.json({
      status: 'ok',
      event_name,
      postback_sent: postbackSent,
      binom_click_id: resolvedBinomClickId,
    });
  } catch (error) {
    console.error('Apphud webhook error:', error);
    res.status(500).json({ error: 'Internal error' });
  }
});

// =====================================================================
// GET /stats — Статистика
// =====================================================================
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

    const organic = db.db.prepare(
      "SELECT COUNT(*) as count FROM installs WHERE date(created_at) = ? AND attribution_status = 'organic'"
    ).get(today);

    const nonOrganic = db.db.prepare(
      "SELECT COUNT(*) as count FROM installs WHERE date(created_at) = ? AND attribution_status = 'non-organic'"
    ).get(today);

    const methods = db.db.prepare(`
      SELECT match_method, COUNT(*) as count FROM installs
      WHERE date(created_at) = ? AND match_method != 'none'
      GROUP BY match_method
    `).all(today);

    // Apphud events stats
    const apphudEvents = db.db.prepare(
      "SELECT COUNT(*) as count FROM apphud_events WHERE date(created_at) = ?"
    ).get(today);

    const apphudRevenue = db.db.prepare(
      "SELECT COALESCE(SUM(proceeds_usd), 0) as total FROM apphud_events WHERE date(created_at) = ? AND event_name IN ('subscription_started', 'trial_converted', 'subscription_renewed', 'non_renewing_purchase')"
    ).get(today);

    const apphudPostbacks = db.db.prepare(
      "SELECT COUNT(*) as count FROM apphud_events WHERE date(created_at) = ? AND postback_sent = 1"
    ).get(today);

    const apphudByEvent = db.db.prepare(`
      SELECT event_name, COUNT(*) as count, COALESCE(SUM(proceeds_usd), 0) as revenue
      FROM apphud_events WHERE date(created_at) = ?
      GROUP BY event_name
    `).all(today);

    res.json({
      date: today,
      clicks: clicks.count,
      installs: installs.count,
      organic: organic.count,
      non_organic: nonOrganic.count,
      matched: matched.count,
      postbacks_sent: postbacks.count,
      match_rate: installs.count > 0
        ? ((matched.count / installs.count) * 100).toFixed(1) + '%'
        : '0%',
      match_methods: methods.reduce((acc, m) => {
        acc[m.match_method] = m.count;
        return acc;
      }, {}),
      apphud: {
        events: apphudEvents.count,
        revenue_usd: Number(apphudRevenue.total.toFixed(2)),
        postbacks_sent: apphudPostbacks.count,
        by_event: apphudByEvent.reduce((acc, e) => {
          acc[e.event_name] = { count: e.count, revenue: Number(e.revenue.toFixed(2)) };
          return acc;
        }, {}),
      },
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
