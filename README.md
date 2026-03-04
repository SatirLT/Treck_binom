# Treck Binom — iOS Install Tracking

Система трекинга установок iOS-приложений с интеграцией в Binom трекер.

## Архитектура

```
Ad Network → /click → Landing Page → App Store → iOS App → /install → Binom Postback
```

### Компоненты

| Компонент | Описание | Путь |
|-----------|----------|------|
| **Server** | Node.js сервер: обработка кликов, матчинг, постбеки | `server/` |
| **Landing** | Лендинг с фингерпринтингом и редиректом в App Store | `landing/` |
| **iOS SDK** | Swift Package для трекинга установок из приложения | `ios-sdk/` |

## Быстрый старт

### 1. Сервер

```bash
cd server
cp .env.example .env
# Отредактируйте .env — укажите URL Binom и API ключ
npm install
npm start
```

### 2. Лендинг

Лендинг раздаётся сервером автоматически по адресу `/landing/index.html`.

Отредактируйте `landing/tracker.js` — укажите:
- `appStoreUrl` — ссылка на ваше приложение в App Store
- `appScheme` — URL scheme вашего приложения (опционально)

### 3. iOS SDK

Добавьте в Xcode через Swift Package Manager:
```
File → Add Packages → указать URL этого репозитория
```

В `AppDelegate.swift`:
```swift
import BinomTracker

func application(_ application: UIApplication, didFinishLaunchingWithOptions ...) -> Bool {
    BinomTracker.shared.configure(serverURL: "https://your-server.com")
    BinomTracker.shared.trackInstall()
    return true
}
```

## Настройка Binom

### Кампания
1. Создайте кампанию в Binom
2. Укажите `CAMPAIGN_ID` в `.env`

### Postback URL
В настройках оффера/партнёрки укажите URL постбека:
```
https://your-binom.com/click.php?cnv_id=CAMPAIGN_ID&cnv_status=install&clickid={clickid}
```

## API Endpoints

| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | `/click` | Входящий клик от рекламной сети |
| POST | `/click/fingerprint` | Обновление фингерпринта с данными браузера |
| POST | `/install` | Регистрация установки от iOS SDK |
| POST | `/event` | Трекинг in-app событий |
| GET | `/stats` | Статистика за сегодня |
| GET | `/health` | Health check |

## Методы матчинга

1. **click_id** (точный) — через clipboard передачу с лендинга в приложение
2. **fingerprint_enhanced** — IP + UA + разрешение экрана + язык + таймзона
3. **fingerprint_server** — IP + UA + модель устройства (fallback)

## Трекинг событий

```swift
// Регистрация
BinomTracker.shared.trackEvent(name: "registration")

// Покупка с revenue
BinomTracker.shared.trackEvent(name: "purchase", value: "product_123", payout: 9.99)
```
