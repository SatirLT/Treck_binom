/**
 * Landing page tracker script.
 *
 * Главная идея:
 * 1. Генерируем уникальный ХЭШ устройства прямо в браузере (client-side)
 * 2. Отправляем хэш на сервер и привязываем к click_id
 * 3. Когда iOS SDK сгенерирует такой же хэш — сервер их сматчит
 *
 * Параметры для хэша (одинаковые в Safari и в iOS-приложении):
 * - Ширина экрана в пикселях (screen.width * devicePixelRatio)
 * - Высота экрана в пикселях (screen.height * devicePixelRatio)
 * - Язык устройства (navigator.language, первые 2 символа)
 * - Часовой пояс (Intl.DateTimeFormat().resolvedOptions().timeZone)
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
   * Возвращает Promise<string> — hex-строку из 64 символов.
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
   * Собирает параметры устройства и генерирует хэш.
   *
   * ВАЖНО: эти же параметры в том же порядке генерируются в iOS SDK.
   * Формат строки для хэширования: "screenW|screenH|lang|timezone"
   *
   * Примеры:
   *   iPhone 15 Pro: "1179|2556|ru|Europe/Moscow"
   *   iPhone 14:     "1170|2532|en|America/New_York"
   */
  function getDeviceParams() {
    // Реальные пиксели экрана (как в iOS: bounds * scale)
    var dpr = window.devicePixelRatio || 1;
    var screenW = Math.round(screen.width * dpr);
    var screenH = Math.round(screen.height * dpr);

    // Язык — берём только код языка (первые 2 символа)
    // iOS: Locale.current.languageCode = "ru"
    // Safari: navigator.language = "ru-RU" → берём "ru"
    var lang = (navigator.language || navigator.userLanguage || 'en');
    lang = lang.split('-')[0].toLowerCase();

    // Часовой пояс — идентичен в Safari и iOS
    var tz = '';
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch (e) {}

    return {
      screenW: String(screenW),
      screenH: String(screenH),
      lang: lang,
      timezone: tz,
    };
  }

  /**
   * Генерирует клиентский хэш устройства.
   * Тот же алгоритм используется в iOS SDK (BinomTracker.swift).
   */
  async function generateClientHash() {
    var p = getDeviceParams();
    var raw = p.screenW + '|' + p.screenH + '|' + p.lang + '|' + p.timezone;
    var hash = await sha256(raw);
    // Берём первые 32 символа (128 бит — достаточно для матчинга)
    return hash.substring(0, 32);
  }

  // ======= РАБОТА С CLICK_ID =======

  function getClickId() {
    var params = new URLSearchParams(window.location.search);
    return params.get('click_id');
  }

  // ======= ОТПРАВКА ДАННЫХ НА СЕРВЕР =======

  /**
   * Отправляет клиентский хэш и параметры на сервер.
   * Сервер сохранит client_hash привязанным к click_id.
   */
  async function sendFingerprint() {
    var clickId = getClickId();
    if (!clickId) return;

    var clientHash = await generateClientHash();
    var params = getDeviceParams();

    var data = {
      click_id: clickId,
      client_hash: clientHash,
      // Отправляем и сырые параметры — для fallback-матчинга на сервере
      screen_width: params.screenW,
      screen_height: params.screenH,
      language: params.lang,
      timezone: params.timezone,
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
      // Silent fail — best effort
    }
  }

  // ======= ПЕРЕДАЧА CLICK_ID В iOS-ПРИЛОЖЕНИЕ =======

  /**
   * Копирует click_id в буфер обмена при нажатии кнопки.
   * iOS SDK прочитает его при первом запуске приложения.
   * Формат: "treck:UUID" — чтобы отличить от обычного текста.
   */
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

    // Копируем click_id в буфер обмена
    copyClickIdToClipboard(clickId);

    // Добавляем click_id в ссылку App Store (через campaign token)
    var storeUrl = CONFIG.appStoreUrl;
    if (clickId) {
      var separator = storeUrl.indexOf('?') >= 0 ? '&' : '?';
      storeUrl += separator + 'ct=' + encodeURIComponent(clickId);
    }

    // Пробуем deep link (если приложение уже установлено)
    if (CONFIG.appScheme) {
      var deepLink = CONFIG.appScheme + 'open?click_id=' + encodeURIComponent(clickId || '');
      window.location.href = deepLink;

      // Если приложение не открылось за 1.5с — идём в App Store
      setTimeout(function() {
        window.location.href = storeUrl;
      }, 1500);
    } else {
      window.location.href = storeUrl;
    }
  }

  // ======= ИНИЦИАЛИЗАЦИЯ =======

  function init() {
    // Отправляем клиентский хэш на сервер
    sendFingerprint();

    // Навешиваем обработчик на кнопку
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
