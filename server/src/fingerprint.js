const crypto = require('crypto');
const UAParser = require('ua-parser-js');

/**
 * Generate a device fingerprint from available signals.
 * Used for probabilistic matching between click and install.
 *
 * Combines: IP + OS version + device model + screen info + language
 * This gives ~80-90% accuracy for matching within a 24h window.
 */
function generateFingerprint({ ip, userAgent, screenWidth, screenHeight, language, timezone }) {
  const parser = new UAParser(userAgent);
  const os = parser.getOS();
  const device = parser.getDevice();

  const components = [
    ip || '',
    os.name || '',
    os.version || '',
    device.model || '',
    device.vendor || '',
    screenWidth || '',
    screenHeight || '',
    language || '',
    timezone || '',
  ];

  const raw = components.join('|');
  return crypto.createHash('sha256').update(raw).digest('hex').substring(0, 32);
}

/**
 * Generate a simpler fingerprint from server-side data only.
 * Used when we don't have JS-collected data (e.g., from iOS SDK).
 */
function generateServerFingerprint({ ip, userAgent }) {
  const parser = new UAParser(userAgent);
  const os = parser.getOS();
  const device = parser.getDevice();

  const components = [
    ip || '',
    os.name || '',
    os.version || '',
    device.model || '',
    device.vendor || '',
  ];

  const raw = components.join('|');
  return crypto.createHash('sha256').update(raw).digest('hex').substring(0, 32);
}

module.exports = {
  generateFingerprint,
  generateServerFingerprint,
};
