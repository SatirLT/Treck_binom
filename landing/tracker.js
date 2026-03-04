/**
 * Landing page tracker script.
 *
 * Главная идея:
 * 1. Генерируем уникальный ХЭШ устройства прямо в браузере (client-side)
 * 2. Отправляем хэш на сервер и привязываем к click_id
 * 3. Когда iOS SDK сгенерирует такой же хэш — сервер их сматчит
 *
 * Параметры для хэша (одинаковые в Safari и в iOS-приложении):
 * - Ширина экрана в пикселях
 * - Высота экрана в пикселях
 * - Язык устройства
 * - Часовой пояс
 * - Версия iOS (из User-Agent)
 * - Device Pixel Ratio (масштаб экрана: 2 или 3)
 */
(function() {
  'use strict';

  // ======= КОНФИГУРАЦИЯ — ИЗМЕНИ ПОД СВОЙ ПРОЕКТ =======
  var CONFIG = {
    // URL сервера (пусто = тот же домен, что и лендинг)
    serverUrl: '',
    // Ссылка на приложение в App Store
    appStoreUrl: 'https://apps.apple.com/app/id000000000',
    // URL-схема приложения (оставь '' если нет)
    appScheme: 'yourapp://',
  };

  // ======= ГЕНЕРАЦИЯ ХЭША НА КЛИЕНТЕ =======

  /**
   * SHA-256 хэш строки через Web Crypto API.
   */
  async function sha256(message) {
    var msgBuffer = new TextEncoder().encode(message);
    var hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    var hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(function(b) {
      return ('00' + b.toString(16)).slice(-2);
    }).join('');
  }

  /**
   * Извлекает версию iOS из User-Agent.
   *
   * Safari UA: "...CPU iPhone OS 17_2_1 like Mac OS X..."
   * Парсим → "17.2.1"
   * Берём major.minor → "17.2" (patch может обновиться между кликом и установкой)
   *
   * В Swift: UIDevice.current.systemVersion → "17.2.1" → берём "17.2"
   */
  function getIOSVersion() {
    var ua = navigator.userAgent;
    var match = ua.match(/OS (\d+)[_.](\d+)/);
    if (match) {
      return match[1] + '.' + match[2]; // "17.2"
    }
    return '';
  }

  /**
   * Собирает параметры устройства.
   *
   * ВАЖНО: эти же параметры в том же порядке генерируются в iOS SDK.
   * Формат строки для хэширования:
   *   "screenW|screenH|lang|timezone|osVersion|dpr"
   *
   * Примеры:
   *   iPhone 15 Pro: "1179|2556|ru|Europe/Moscow|17.2|3"
   *   iPhone SE 3:   "750|1334|en|America/New_York|17.2|2"
   */
  function getDeviceParams() {
    // Реальные пиксели экрана (как в iOS: bounds * scale)
    var dpr = window.devicePixelRatio || 1;
    var screenW = Math.round(screen.width * dpr);
    var screenH = Math.round(screen.height * dpr);

    // Язык — только код языка (первые 2 символа)
    var lang = (navigator.language || navigator.userLanguage || 'en');
    lang = lang.split('-')[0].toLowerCase();

    // Часовой пояс — идентичен в Safari и iOS
    var tz = '';
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch (e) {}

    // Версия iOS (major.minor)
    var osVersion = getIOSVersion();

    // Device Pixel Ratio как целое число (2 или 3 на iOS)
    var dprInt = String(Math.round(dpr));

    return {
      screenW: String(screenW),
      screenH: String(screenH),
      lang: lang,
      timezone: tz,
      osVersion: osVersion,
      dpr: dprInt,
    };
  }

  /**
   * Генерирует клиентский хэш устройства.
   * Тот же алгоритм используется в iOS SDK (BinomTracker.swift).
   */
  async function generateClientHash() {
    var p = getDeviceParams();
    var raw = [p.screenW, p.screenH, p.lang, p.timezone, p.osVersion, p.dpr].join('|');
    var hash = await sha256(raw);
    return hash.substring(0, 32);
  }

  // ======= РАБОТА С CLICK_ID =======

  function getClickId() {
    var params = new URLSearchParams(window.location.search);
    return params.get('click_id');
  }

  // ======= ОТПРАВКА ДАННЫХ НА СЕРВЕР =======

  async function sendFingerprint() {
    var clickId = getClickId();
    if (!clickId) return;

    var clientHash = await generateClientHash();
    var params = getDeviceParams();

    var data = {
      click_id: clickId,
      client_hash: clientHash,
      // Сырые параметры для fallback-матчинга
      screen_width: params.screenW,
      screen_height: params.screenH,
      language: params.lang,
      timezone: params.timezone,
      os_version: params.osVersion,
      dpr: params.dpr,
    };

    var url = CONFIG.serverUrl + '/click/fingerprint';
    var payload = JSON.stringify(data);

    try {
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
      // Silent fail
    }
  }

  // ======= ПЕРЕДАЧА CLICK_ID В iOS-ПРИЛОЖЕНИЕ =======

  function copyClickIdToClipboard(clickId) {
    if (!clickId || !navigator.clipboard) return;
    try {
      navigator.clipboard.writeText('treck:' + clickId).catch(function() {});
    } catch (e) {}
  }

  // ======= КНОПКА "СКАЧАТЬ" =======

  function handleDownload(e) {
    e.preventDefault();
    var clickId = getClickId();

    copyClickIdToClipboard(clickId);

    var storeUrl = CONFIG.appStoreUrl;
    if (clickId) {
      var separator = storeUrl.indexOf('?') >= 0 ? '&' : '?';
      storeUrl += separator + 'ct=' + encodeURIComponent(clickId);
    }

    if (CONFIG.appScheme) {
      var deepLink = CONFIG.appScheme + 'open?click_id=' + encodeURIComponent(clickId || '');
      window.location.href = deepLink;

      setTimeout(function() {
        window.location.href = storeUrl;
      }, 1500);
    } else {
      window.location.href = storeUrl;
    }
  }

  // ======= ИНИЦИАЛИЗАЦИЯ =======

  function init() {
    sendFingerprint();

    var btn = document.getElementById('downloadBtn');
    if (btn) {
      btn.addEventListener('click', handleDownload);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
