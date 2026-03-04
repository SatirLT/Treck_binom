const fetch = require('node-fetch');
const config = require('./config');

const BINOM_URL = config.binom.url.replace(/\/$/, '');

/**
 * Register a click in Binom tracker via Click API.
 * Returns Binom's click_id for later postback.
 *
 * Binom Click API: GET /click.php?cnv_id=CAMPAIGN_ID&...tokens
 */
async function registerClick({ ip, userAgent, referer, subParams }) {
  const params = new URLSearchParams({
    cnv_id: config.binom.campaignId,
    ip,
    ua: userAgent || '',
    ref: referer || '',
  });

  // Pass sub parameters (sub1..sub15) if provided
  if (subParams) {
    try {
      const subs = typeof subParams === 'string' ? JSON.parse(subParams) : subParams;
      Object.entries(subs).forEach(([key, value]) => {
        if (value) params.append(key, value);
      });
    } catch (e) {
      // ignore malformed sub params
    }
  }

  try {
    const url = `${BINOM_URL}/click.php?${params.toString()}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': userAgent || '' },
      timeout: 5000,
    });

    if (!response.ok) {
      console.error(`Binom click API error: ${response.status}`);
      return null;
    }

    // Binom returns HTML with redirect or click ID in headers/body
    const body = await response.text();

    // Try to extract click_id from response
    // Binom typically sets it in a cookie or returns in URL
    const clickIdMatch = body.match(/uclick=([a-zA-Z0-9]+)/);
    if (clickIdMatch) {
      return clickIdMatch[1];
    }

    // Check Location header for redirect with click_id
    const location = response.headers.get('location');
    if (location) {
      const urlMatch = location.match(/[?&]uclick=([a-zA-Z0-9]+)/);
      if (urlMatch) return urlMatch[1];
    }

    // Return null if we couldn't extract click_id
    // The click is still registered in Binom
    return null;
  } catch (error) {
    console.error('Binom click registration failed:', error.message);
    return null;
  }
}

/**
 * Send conversion postback to Binom.
 * Binom Postback URL format: /click.php?cnv_id=CAMPAIGN&cnv_status=&payout=&clickid=
 */
async function sendPostback({ binomClickId, status = 'install', payout = 0, eventName }) {
  if (!binomClickId) {
    console.warn('No Binom click_id — skipping postback');
    return false;
  }

  const params = new URLSearchParams({
    cnv_id: config.binom.campaignId,
    cnv_status: status,
    payout: String(payout),
    clickid: binomClickId,
  });

  // Add event token if specified (Binom events feature)
  if (eventName) {
    params.append('event', eventName);
  }

  try {
    const url = `${BINOM_URL}/click.php?${params.toString()}`;
    const response = await fetch(url, { timeout: 5000 });

    if (!response.ok) {
      console.error(`Binom postback error: ${response.status}`);
      return false;
    }

    console.log(`Postback sent: clickId=${binomClickId}, status=${status}`);
    return true;
  } catch (error) {
    console.error('Binom postback failed:', error.message);
    return false;
  }
}

/**
 * Get campaign stats via Binom API.
 */
async function getCampaignStats(campaignId, dateFrom, dateTo) {
  const params = new URLSearchParams({
    page: 'Stats',
    camp_id: campaignId || config.binom.campaignId,
    api_key: config.binom.apiKey,
    date_s: dateFrom || new Date().toISOString().split('T')[0],
    date_e: dateTo || new Date().toISOString().split('T')[0],
    group1: '1', // Group by day
  });

  try {
    const url = `${BINOM_URL}/api.php?${params.toString()}`;
    const response = await fetch(url, { timeout: 10000 });
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error('Binom API stats failed:', error.message);
    return null;
  }
}

module.exports = {
  registerClick,
  sendPostback,
  getCampaignStats,
};
