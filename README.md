# Treck Binom — Трекинг установок iOS-приложений + покупки через Apphud

## Что это такое и зачем нужно?

Представь: ты запускаешь рекламу своего iOS-приложения (Facebook, TikTok, Google и т.д.). Люди кликают, скачивают приложение, покупают подписку. Но как узнать:
- **Какая реклама** привела к установке?
- **Сколько денег** принёс каждый рекламный канал?
- Пользователь **пришёл с рекламы** или **сам нашёл** приложение?

**Treck Binom** решает все три задачи:

1. **Запоминает** откуда пришёл пользователь (с какой рекламы, кампании)
2. **Матчит** — когда человек установит приложение, находит его в базе
3. **Определяет статус** — Organic (сам нашёл) или Non-Organic (пришёл с рекламы)
4. **Связывает покупки** — через Apphud привязывает подписки/покупки к кликам
5. **Отправляет в Binom** — установки и покупки с revenue, чтобы считать ROI

---

## Как это работает? (простым языком)

```
ФАЗА 1: КЛИК И УСТАНОВКА

  Пользователь видит рекламу → кликает
         │
         ▼
  GET /click — наш сервер запоминает: IP, устройство, время
  Генерирует click_id + отправляет клик в Binom (получает binom_click_id)
         │
         ▼
  Лендинг — красивая страница с кнопкой "Скачать"
  tracker.js собирает: размер экрана, язык, часовой пояс, версию iOS
  Генерирует ХЭШ устройства (уникальный отпечаток)
  Копирует click_id в буфер обмена (как Ctrl+C)
         │
         ▼
  App Store → пользователь скачивает приложение
         │
         ▼
  Первый запуск приложения
  BinomTracker.trackInstall():
    - Читает click_id из буфера обмена (Ctrl+V)
    - Генерирует ТАКОЙ ЖЕ хэш устройства
    - Отправляет на сервер POST /install
         │
         ▼
  Сервер МАТЧИТ: "Этот хэш совпадает с хэшем от лендинга!"
  Отвечает: "Non-Organic, binom_click_id = xyz, source = facebook"
         │
         ▼
  Постбек в Binom: "С рекламы X получена 1 установка"


ФАЗА 2: ПОКУПКИ (ЧЕРЕЗ APPHUD)

  Пользователь покупает подписку в приложении
         │
         ▼
  Apphud обрабатывает транзакцию (Apple → Apphud)
         │
         ▼
  Apphud Connection Builder отправляет POST /apphud/webhook
  В запросе: event_name, price, proceeds + binom_click_id из user_properties
         │
         ▼
  Наш сервер получает binom_click_id → шлёт постбек в Binom
  Binom записывает: "Клик X → Установка → Покупка $6.99"
         │
         ▼
  В Binom видно ROI: потратил $2 на рекламу → получил $6.99 = ROI 249%


ФАЗА 3: ВОРОНКИ В ПРИЛОЖЕНИИ

  При запуске приложения вызываем BinomTracker.checkStatus()
         │
         ▼
  Ответ: "non-organic" или "organic"
         │
         ├── Non-Organic → показываем агрессивный пейволл (рекламная воронка)
         │
         └── Organic → показываем стандартный онбординг
```

---

## Из чего состоит проект?

```
Treck_binom/
│
├── server/             ← СЕРВЕР (мозг системы)
│   ├── src/
│   │   ├── index.js         ← Все эндпоинты: /click, /install, /status, /apphud/webhook
│   │   ├── config.js        ← Настройки (Binom URL, Apphud token, порт)
│   │   ├── database.js      ← База данных SQLite (клики, установки, покупки)
│   │   └── binom.js         ← Общение с Binom (клики + постбеки)
│   ├── package.json
│   └── .env.example         ← Пример файла с настройками
│
├── landing/            ← ЛЕНДИНГ (страница для пользователя)
│   ├── index.html           ← HTML с кнопкой "Скачать"
│   └── tracker.js           ← Сбор данных + генерация хэша устройства
│
├── ios-sdk/            ← iOS SDK (библиотека для приложения)
│   ├── Package.swift
│   ├── Sources/BinomTracker/
│   │   └── BinomTracker.swift   ← Трекер: установка, статус, события, Apphud
│   └── Examples/
│       └── AppDelegate-Example.swift
│
├── docs/               ← ДОКУМЕНТАЦИЯ
│   └── apphud-connection-builder-setup.md  ← Инструкция по Apphud
│
├── Dockerfile
├── docker-compose.yml
└── README.md           ← Этот файл
```

---

## Что нужно для работы?

### Обязательно:
- **Node.js 18+** — [скачать](https://nodejs.org/)
- **Binom трекер** — купленный и настроенный на своём домене
- **Xcode 14+** — для iOS-разработки (на Mac)

### Для покупок (опционально):
- **Apphud** — [apphud.com](https://apphud.com) (план Expert или Enterprise для Connection Builder)
- Apphud SDK установлен в iOS-приложение

---

## Пошаговая установка

### Шаг 1: Скачиваем проект

```bash
git clone https://github.com/your-username/Treck_binom.git
cd Treck_binom
```

### Шаг 2: Настраиваем сервер

```bash
cd server
cp .env.example .env
```

Открой `server/.env` и заполни:

```env
# === BINOM ===
# URL трекера (без / в конце). Пример: https://tracker.mysite.com
BINOM_URL=https://your-binom-domain.com

# API-ключ (Binom → Settings → API)
BINOM_API_KEY=your_api_key_here

# === СЕРВЕР ===
PORT=3000

# Публичный URL сервера (который видят пользователи)
BASE_URL=https://your-server-domain.com

# === КАМПАНИЯ ===
# ID кампании в Binom (число из таблицы Campaigns)
CAMPAIGN_ID=1
LANDING_ID=1

# === APPHUD (если используешь покупки) ===
# Секретный токен для проверки вебхуков
# Придумай любую строку и укажи её же в Apphud Dashboard
APPHUD_SECRET_TOKEN=my-super-secret-token-123
```

**Где это всё взять?**

| Настройка | Где найти |
|-----------|-----------|
| `BINOM_URL` | Адрес, по которому ты заходишь в Binom |
| `BINOM_API_KEY` | Binom → Settings → API → скопировать ключ |
| `CAMPAIGN_ID` | Binom → Campaigns → число в первом столбце |
| `BASE_URL` | Домен твоего сервера (где развёрнут этот проект) |
| `APPHUD_SECRET_TOKEN` | Придумай сам (любая строка, чем длиннее — тем безопаснее) |

Устанавливаем зависимости и запускаем:

```bash
npm install
npm start
```

Увидишь:
```
Treck Binom server running on port 3000
Landing page: https://your-server-domain.com/landing/index.html
Click URL: https://your-server-domain.com/click
```

### Шаг 3: Настраиваем лендинг

Открой `landing/tracker.js`, найди `CONFIG` в начале:

```javascript
var CONFIG = {
    // Оставь пустым, если лендинг и сервер на одном домене
    serverUrl: '',

    // Ссылка на СВОЁ приложение в App Store
    appStoreUrl: 'https://apps.apple.com/app/id000000000',

    // URL-схема приложения (если есть). Не знаешь — оставь ''
    appScheme: 'yourapp://',
};
```

**Как найти ссылку App Store?** Открой apps.apple.com → найди своё приложение → скопируй URL.

**Что такое URL-схема?** Когда приложение открывается по ссылке типа `telegram://` или `instagram://`. Не знаешь — оставь пустым.

### Шаг 4: Встраиваем SDK в iOS-приложение

#### 4.1 Добавляем пакет в Xcode

1. Xcode → **File** → **Add Package Dependencies...**
2. Вставь URL репозитория
3. Нажми **Add Package**
4. Отметь `BinomTracker` галочкой → **Add Package**

#### 4.2 Минимальный код (без Apphud)

```swift
import BinomTracker

func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
) -> Bool {

    // 1. Настраиваем (замени URL на свой!)
    BinomTracker.shared.configure(
        serverURL: "https://your-server-domain.com",
        debug: true  // false в продакшене
    )

    // 2. Трекаем установку
    BinomTracker.shared.trackInstall { status in
        guard let status = status else { return }
        print("Статус: \(status.status)")  // "organic" или "non-organic"
    }

    return true
}
```

#### 4.3 Полный код (с Apphud + воронки)

```swift
import BinomTracker
import ApphudSDK

func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
) -> Bool {

    // 1. СНАЧАЛА Apphud (до BinomTracker!)
    Apphud.start(apiKey: "your_apphud_api_key")

    // 2. Потом BinomTracker
    BinomTracker.shared.configure(
        serverURL: "https://your-server-domain.com",
        debug: true
    )

    // 3. Трекаем установку
    //    BinomTracker АВТОМАТИЧЕСКИ прокинет данные в Apphud:
    //    - binom_click_id (для постбеков покупок)
    //    - attribution_status (organic / non-organic)
    //    - campaign_source, campaign_id и т.д.
    BinomTracker.shared.trackInstall { status in
        guard let status = status else { return }

        if status.isNonOrganic {
            print("Пришёл с рекламы! Источник: \(status.campaignData["source"] ?? "")")
        }
    }

    return true
}
```

#### 4.4 Воронки: показываем разный контент

```swift
// Где-нибудь на экране онбординга или пейволла:

BinomTracker.shared.checkStatus { status in
    DispatchQueue.main.async {
        if status.isNonOrganic {
            // Пользователь пришёл с рекламы →
            // показываем агрессивный пейволл / специальную воронку
            self.showAdFunnel()
        } else {
            // Organic пользователь →
            // стандартный онбординг
            self.showStandardOnboarding()
        }
    }
}
```

**Важно:** `checkStatus()` работает быстро — первый вызов идёт на сервер, все последующие берут результат из кэша (UserDefaults). Можно вызывать сколько угодно раз.

#### 4.5 Трекинг событий (опционально)

```swift
// Регистрация
BinomTracker.shared.trackEvent(name: "registration")

// Покупка (в дополнение к Apphud)
BinomTracker.shared.trackEvent(name: "purchase", value: "premium", payout: 9.99)

// Любое событие
BinomTracker.shared.trackEvent(name: "level_complete", value: "5")
```

---

## Настройка Apphud Connection Builder (для покупок)

Это нужно, чтобы **покупки из Apphud** приходили в **Binom** с revenue.

### Зачем?

Без этого Binom видит только установки. С этим — видит полную картину:
```
Клик → Установка → Покупка $9.99 (proceeds $6.99) → ROI = 249%
```

### Как настроить (пошагово)

#### 1. Откройте Apphud Dashboard

**Connections** → **Integrations** → **Connection Builder** → **Add Connection**

#### 2. Заполните основные поля

| Поле | Значение |
|------|----------|
| **Source** | iOS |
| **Name** | Binom Postback |
| **URL** | `https://your-server.com/apphud/webhook` |
| **Header Name** | `X-Apphud-Token` |
| **Header Value** | тот же токен что в `APPHUD_SECRET_TOKEN` |

#### 3. Выберите события

Включите галочками:

| Событие | Что значит |
|---------|-----------|
| `trial_started` | Пользователь начал пробный период |
| `trial_converted` | Оплатил после триала |
| `subscription_started` | Купил подписку |
| `subscription_renewed` | Подписка автоматически продлилась |
| `non_renewing_purchase` | Разовая покупка |
| `subscription_refunded` | Запросил возврат |
| `subscription_canceled` | Отменил автопродление |

#### 4. Вставьте JSON-шаблон в Body

Скопируйте этот JSON целиком:

```json
{
  "event_id": "{{ event.id }}",
  "event_name": "{{ event.name }}",
  "product_id": "{{ event.receipt.product_id }}",
  "price_usd": {{ event.receipt.price_usd | default: 0 }},
  "proceeds_usd": {{ event.receipt.proceeds_usd | default: 0 }},
  "currency": "{{ event.receipt.currency | default: 'USD' }}",
  "transaction_id": "{{ event.receipt.transaction_id }}",
  "original_transaction_id": "{{ event.receipt.original_transaction_id }}",
  "user_id": "{{ user.user_id }}",
  "binom_click_id": "{{ user.user_properties.binom_click_id }}",
  "treck_click_id": "{{ user.user_properties.treck_click_id }}",
  "attribution_status": "{{ user.user_properties.attribution_status }}",
  "campaign_source": "{{ user.user_properties.campaign_source }}",
  "campaign_id": "{{ user.user_properties.campaign_id }}",
  "creative_id": "{{ user.user_properties.creative_id }}"
}
```

**Что это за `{{ ... }}`?** Это шаблоны Liquid — Apphud подставит сюда реальные данные. Например, `{{ event.receipt.price_usd }}` заменится на `9.99`.

**Откуда берётся `{{ user.user_properties.binom_click_id }}`?** Наш BinomTracker SDK автоматически записал это свойство в Apphud при trackInstall(). Apphud его запомнил и теперь подставляет в шаблон.

#### 5. Протестируйте

В Connection Builder нажмите иконку 👁️ → введите Transaction ID тестовой покупки → Apphud отправит тестовый запрос на ваш сервер.

#### 6. Ручной тест (curl)

```bash
curl -X POST https://your-server.com/apphud/webhook \
  -H "Content-Type: application/json" \
  -H "X-Apphud-Token: my-super-secret-token-123" \
  -d '{
    "event_name": "subscription_started",
    "product_id": "com.app.premium_monthly",
    "price_usd": 9.99,
    "proceeds_usd": 6.99,
    "currency": "USD",
    "transaction_id": "test-txn-001",
    "user_id": "user-123",
    "binom_click_id": "abc123",
    "treck_click_id": "550e8400-e29b-41d4-a716-446655440000",
    "attribution_status": "non-organic"
  }'
```

Ожидаемый ответ:
```json
{
  "status": "ok",
  "event_name": "subscription_started",
  "postback_sent": true,
  "binom_click_id": "abc123"
}
```

---

## Как работает матчинг? (сопоставление клика и установки)

Когда приходит установка, сервер пробует найти клик **6 способами** — от самого точного к наименее точному. Как только находит — останавливается.

| # | Метод | Точность | Как работает |
|---|-------|----------|-------------|
| 1 | `click_id` | ~99% | Лендинг скопировал click_id в буфер обмена → приложение прочитало |
| 2 | `client_hash` | ~95% | Лендинг и приложение сгенерировали одинаковый хэш устройства |
| 3 | IP + экран + язык + TZ + iOS | ~90% | Все параметры совпали |
| 4 | IP + экран + язык + TZ | ~80% | Почти все параметры совпали |
| 5 | IP + экран | ~65% | Совпали IP и размер экрана |
| 6 | Только IP | ~35% | Последний шанс, самый неточный |

### Что входит в хэш устройства?

Хэш — это SHA-256 от строки вида:

```
"1179|2556|ru|Europe/Moscow|17.2|3"
  │     │   │       │         │   │
  │     │   │       │         │   └── Device Pixel Ratio (2 или 3)
  │     │   │       │         └── Версия iOS (major.minor, без patch)
  │     │   │       └── Часовой пояс
  │     │   └── Язык (2 буквы)
  │     └── Высота экрана в пикселях
  └── Ширина экрана в пикселях
```

**Почему без patch-версии?** Между кликом и установкой может пройти время, и iOS может обновиться с 17.2.0 до 17.2.1. Major.minor (17.2) не изменится, а patch — может.

Хэш генерируется **одинаково** на лендинге (JavaScript) и в приложении (Swift). Если совпал — это одно и то же устройство.

---

## API-эндпоинты сервера

### GET `/click` — Регистрация клика

Сюда перенаправляется пользователь с рекламы.

**Ссылка для рекламы:**
```
https://your-server.com/click?sub1=facebook&sub2=campaign_123&source=fb
```

**Параметры (все необязательные):**
- `sub1` ... `sub15` — метки для аналитики
- `clickid` — click_id от рекламной сети
- `source` — название источника
- `campaign_id` — ID кампании
- `creative_id` — ID креатива
- `adset_id` — ID группы объявлений
- `ad_id` — ID объявления
- `placement` — площадка

**Что делает:** сохраняет клик → регистрирует в Binom → перенаправляет на лендинг.

---

### POST `/click/fingerprint` — Фингерпринт с лендинга

Вызывается **автоматически** скриптом `tracker.js`. Не нужно вызывать вручную.

---

### POST `/install` — Регистрация установки

Вызывается **автоматически** iOS SDK при первом запуске.

**Ответ:**
```json
{
  "status": "ok",
  "attribution_status": "non-organic",
  "matched": true,
  "match_method": "client_hash",
  "postback_sent": true,
  "click_id": "550e8400-...",
  "binom_click_id": "abc123xyz",
  "campaign_data": {
    "source": "facebook",
    "campaign_id": "123",
    "sub1": "fb_ios"
  }
}
```

---

### POST `/status` — Проверка: Organic или Non-Organic?

Приложение может в любой момент спросить: "Этот пользователь пришёл с рекламы?"

**Ответ:**
```json
{
  "status": "non-organic",
  "match_method": "client_hash",
  "click_id": "550e8400-...",
  "binom_click_id": "abc123xyz",
  "campaign_data": {
    "source": "facebook"
  }
}
```

Или для organic пользователя:
```json
{
  "status": "organic",
  "match_method": "none",
  "click_id": null,
  "binom_click_id": null,
  "campaign_data": {}
}
```

---

### POST `/apphud/webhook` — Приём покупок из Apphud

Apphud Connection Builder отправляет сюда данные о покупках. **Не вызывайте вручную** — это делает Apphud автоматически.

**Маппинг событий Apphud → Binom:**

| Событие Apphud | Статус в Binom | Payout |
|----------------|---------------|--------|
| `trial_started` | `trial` | $0 |
| `trial_converted` | `purchase` | proceeds_usd |
| `subscription_started` | `purchase` | proceeds_usd |
| `subscription_renewed` | `rebill` | proceeds_usd |
| `non_renewing_purchase` | `purchase` | proceeds_usd |
| `subscription_refunded` | `refund` | proceeds_usd |
| `subscription_canceled` | `cancel` | $0 |

**proceeds_usd** — это то, что вы получаете после комиссии Apple (обычно 70-85% от цены).

---

### POST `/event` — Трекинг in-app событий

Для отслеживания действий внутри приложения (регистрация, уровни и т.д.).

```json
{
  "device_id": "uuid-устройства",
  "idfv": "идентификатор-вендора",
  "event_name": "purchase",
  "event_value": "premium_monthly",
  "payout": 9.99
}
```

---

### GET `/stats` — Статистика за сегодня

Открой в браузере: `https://your-server.com/stats`

```json
{
  "date": "2026-03-05",
  "clicks": 150,
  "installs": 45,
  "organic": 12,
  "non_organic": 33,
  "matched": 33,
  "postbacks_sent": 33,
  "match_rate": "73.3%",
  "match_methods": {
    "click_id": 15,
    "client_hash": 12,
    "ip_screen_lang_tz_os": 4,
    "ip_screen_lang_tz": 2
  },
  "apphud": {
    "events": 8,
    "revenue_usd": 49.93,
    "postbacks_sent": 6,
    "by_event": {
      "subscription_started": { "count": 5, "revenue": 34.95 },
      "trial_started": { "count": 3, "revenue": 0 }
    }
  }
}
```

---

### GET `/health` — Жив ли сервер?

```json
{ "status": "ok", "timestamp": "2026-03-05T12:00:00.000Z" }
```

---

## Запуск через Docker

Если не хочешь ставить Node.js:

```bash
# Создай .env в корне проекта (такие же переменные)
docker-compose up -d

# Логи
docker-compose logs -f

# Остановить
docker-compose down
```

---

## Настройка Binom

### Создание кампании

1. **Binom** → **Campaigns** → **Create**
2. Заполни Name, Traffic Source, Offer
3. **Запомни Campaign ID** → вписываешь в `.env`

### Постбек для CPA-сети

Если работаешь через партнёрку:
```
https://your-binom-domain.com/click.php?cnv_id=CAMPAIGN_ID&cnv_status=install&clickid={clickid}
```

---

## Полная схема системы

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Реклама    │────▶│  Наш сервер  │────▶│   Binom     │
│  (FB, TT)   │     │  /click      │     │  click.php  │
└─────────────┘     └──────┬───────┘     └─────────────┘
                           │
                    ┌──────▼───────┐
                    │   Лендинг    │
                    │  tracker.js  │
                    │  (хэш + ID)  │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │  App Store   │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐     ┌──────────────┐     ┌─────────────┐
                    │ iOS-прилож.  │────▶│  Наш сервер  │────▶│   Binom     │
                    │ BinomTracker │     │  /install     │     │  postback   │
                    │ + ApphudSDK  │     │  /status      │     │  (install)  │
                    └──────┬───────┘     └──────────────┘     └─────────────┘
                           │
                    ┌──────▼───────┐     ┌──────────────┐     ┌─────────────┐
                    │   Покупка    │────▶│   Apphud     │     │             │
                    │  подписки    │     │  обработка   │     │             │
                    └──────────────┘     └──────┬───────┘     │             │
                                               │              │             │
                                        ┌──────▼───────┐     │   Binom     │
                                        │  Connection  │────▶│  postback   │
                                        │  Builder     │     │  (purchase  │
                                        │  POST webhook│     │   + $$$)    │
                                        └──────────────┘     └─────────────┘
```

---

## Тестирование

### Проверить сервер:
```bash
# Работает ли?
curl http://localhost:3000/health

# Симулировать клик
curl -L http://localhost:3000/click?sub1=test

# Статистика
curl http://localhost:3000/stats
```

### Проверить полный флоу:
1. Открой в Safari на iPhone: `https://your-server.com/click?sub1=test`
2. Ты попадёшь на лендинг
3. Нажми "Download"
4. Запусти приложение с SDK на этом же iPhone
5. Проверь `https://your-server.com/stats`

### Тест Apphud:
1. Сделай тестовую покупку в sandbox
2. Проверь Connection Builder логи в Apphud Dashboard
3. Проверь `https://your-server.com/stats` → раздел `apphud`

---

## Частые проблемы

### Сервер не запускается
```
Error: Cannot find module 'express'
```
Забыл `npm install` в папке `server/`.

### Установки не матчатся (match_rate = 0%)
- Неправильный `serverUrl` в `tracker.js`
- iOS SDK указывает на неправильный сервер
- Пользователь переключился с Wi-Fi на мобильный (другой IP)

### Постбеки не приходят в Binom
- Проверь `BINOM_URL` и `CAMPAIGN_ID` в `.env`
- Открой URL Binom в браузере — работает ли он?

### Apphud вебхуки не приходят
- Проверь URL в Connection Builder: `https://your-server.com/apphud/webhook`
- Проверь токен: `X-Apphud-Token` должен совпадать с `APPHUD_SECRET_TOKEN`
- Включены ли нужные события в Connection Builder?
- Apphud не шлёт sandbox-события по умолчанию

### iOS SDK: "Apphud SDK not found"
Это **нормально**, если Apphud не используется. BinomTracker проверяет наличие Apphud через runtime — если не найден, просто пропускает синхронизацию.

### Покупки не связываются с кликами
- Убедись что `Apphud.start()` вызывается **ДО** `BinomTracker.trackInstall()`
- Проверь в Apphud Dashboard → Users → конкретный юзер → User Properties: есть ли `binom_click_id`?

---

## Словарь терминов

| Термин | Что значит |
|--------|-----------|
| **Клик (Click)** | Пользователь нажал на рекламу |
| **Установка (Install)** | Скачал и открыл приложение |
| **Матчинг (Matching)** | Сопоставление: "клик и установка — один человек" |
| **Постбек (Postback)** | Уведомление трекеру: "получена установка / покупка" |
| **Хэш (Hash)** | "Отпечаток" устройства — уникальная строка из параметров экрана, языка и т.д. |
| **Organic** | Пользователь сам нашёл приложение (не через рекламу) |
| **Non-Organic** | Пришёл с рекламы |
| **Binom** | Трекер рекламного трафика |
| **Apphud** | Сервис обработки подписок и покупок |
| **Connection Builder** | Инструмент Apphud для отправки событий на внешние серверы |
| **SDK** | Библиотека для встраивания в приложение |
| **Лендинг (Landing)** | Промежуточная страница между рекламой и App Store |
| **ROI** | Return on Investment — окупаемость рекламы (потратил $2, заработал $7 = ROI 250%) |
| **Revenue / Proceeds** | Доход. Price = цена для юзера, Proceeds = после комиссии Apple |
| **IDFV** | Identifier for Vendor — идентификатор устройства для разработчика |
| **Deep Link** | Ссылка, открывающая конкретный экран приложения |
| **Webhook** | Автоматический HTTP-запрос при событии (покупка → POST на сервер) |
