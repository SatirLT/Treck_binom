/**
 * Landing page tracker script.
 * 1. Collects device fingerprint data from browser
 * 2. Sends enhanced fingerprint to server
 * 3. Stores click_id for potential deep link / clipboard pass
 * 4. Handles App Store redirect on button click
 */
(function() {
  'use strict';

  // Configuration — update these for your app
  var CONFIG = {
    // Server endpoint base URL (same origin by default)
    serverUrl: '',
    // App Store URL — replace with your actual app URL
    appStoreUrl: 'https://apps.apple.com/app/id000000000',
    // Custom URL scheme for deep linking (optional)
    appScheme: 'yourapp://',
  };

  // Extract click_id from URL
  function getClickId() {
    var params = new URLSearchParams(window.location.search);
    return params.get('click_id');
  }

  // Collect device/browser fingerprint data
  function collectFingerprint() {
    return {
      click_id: getClickId(),
      screenWidth: screen.width,
      screenHeight: screen.height,
      language: navigator.language || navigator.userLanguage || '',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    };
  }

  // Send fingerprint data to server
  function sendFingerprint(data) {
    var url = CONFIG.serverUrl + '/click/fingerprint';
    try {
      // Use sendBeacon for reliability, fall back to fetch
      var payload = JSON.stringify(data);
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
      } else {
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true,
        }).catch(function() {});
      }
    } catch (e) {
      // Silent fail — fingerprint is best-effort
    }
  }

  // Store click_id to clipboard (for iOS 16+ paste detection)
  function storeClickId(clickId) {
    if (!clickId) return;

    // Store in localStorage as backup
    try {
      localStorage.setItem('treck_click_id', clickId);
    } catch (e) {}

    // Try to write to clipboard (requires user gesture on iOS)
    // The actual clipboard write happens on the download button click
  }

  // Copy click_id to clipboard on user gesture
  function copyClickIdToClipboard(clickId) {
    if (!clickId || !navigator.clipboard) return;
    try {
      navigator.clipboard.writeText('treck:' + clickId).catch(function() {});
    } catch (e) {}
  }

  // Try to open app via custom URL scheme, then redirect to App Store
  function handleDownload(e) {
    e.preventDefault();
    var clickId = getClickId();

    // Copy click_id to clipboard for iOS SDK to retrieve
    copyClickIdToClipboard(clickId);

    // Build App Store URL with click_id in campaign token
    var storeUrl = CONFIG.appStoreUrl;
    if (clickId) {
      var separator = storeUrl.indexOf('?') >= 0 ? '&' : '?';
      storeUrl += separator + 'ct=' + encodeURIComponent(clickId);
    }

    // Try deep link first (if app is already installed)
    if (CONFIG.appScheme) {
      var deepLink = CONFIG.appScheme + 'open?click_id=' + encodeURIComponent(clickId || '');
      window.location.href = deepLink;

      // If app doesn't open within 1.5s, redirect to App Store
      setTimeout(function() {
        window.location.href = storeUrl;
      }, 1500);
    } else {
      window.location.href = storeUrl;
    }
  }

  // Initialize
  function init() {
    var clickId = getClickId();

    // Send enhanced fingerprint to server
    var fpData = collectFingerprint();
    if (fpData.click_id) {
      sendFingerprint(fpData);
    }

    // Store click_id
    storeClickId(clickId);

    // Set up download button
    var btn = document.getElementById('downloadBtn');
    if (btn) {
      btn.addEventListener('click', handleDownload);
    }
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
