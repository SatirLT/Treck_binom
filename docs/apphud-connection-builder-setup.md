# Настройка Apphud Connection Builder → Binom

## Схема работы

```
Покупка в iOS-приложении
    ↓
Apphud обрабатывает транзакцию
    ↓
Connection Builder отправляет POST запрос на ваш сервер
    ↓
Сервер извлекает binom_click_id из user_properties
    ↓
Постбек в Binom (event + revenue)
```

## Предварительные требования

1. iOS SDK установлен и настроен (BinomTracker + ApphudSDK)
2. В приложении вызывается `BinomTracker.shared.trackInstall()` **после** `Apphud.start()`
3. Сервер запущен и доступен по публичному URL

## Шаг 1: Создание подключения в Apphud

1. Откройте **Apphud Dashboard** → **Connections** → **Integrations**
2. Нажмите **Connection Builder** → **Add Connection**
3. Выберите **Source**: `iOS`
4. Заполните:
   - **Name**: `Binom Postback`
   - **URL**: `https://your-server.com/apphud/webhook`
   - **Header Name**: `X-Apphud-Token`
   - **Header Value**: ваш секретный токен (тот же что в `APPHUD_SECRET_TOKEN` на сервере)

## Шаг 2: Выбор событий

Включите следующие события:

| Событие Apphud | Описание | Статус в Binom |
|---|---|---|
| `trial_started` | Начало пробного периода | `trial` |
| `trial_converted` | Оплата после триала | `purchase` |
| `subscription_started` | Новая подписка | `purchase` |
| `subscription_renewed` | Продление подписки | `rebill` |
| `non_renewing_purchase` | Разовая покупка | `purchase` |
| `subscription_refunded` | Возврат | `refund` |
| `subscription_canceled` | Отмена автопродления | `cancel` |

## Шаг 3: Настройка тела запроса (Body)

Скопируйте этот JSON в поле Body:

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

### Что делают макросы:

- `{{ event.receipt.proceeds_usd }}` — доход после комиссии Apple (то, что вы получаете)
- `{{ user.user_properties.binom_click_id }}` — ID клика в Binom (прокидывается BinomTracker SDK)
- `{{ user.user_properties.treck_click_id }}` — наш внутренний click_id (для fallback-поиска)
- `{{ user.user_properties.attribution_status }}` — "non-organic" или "organic"

## Шаг 4: Фильтры (опционально)

Рекомендуемые фильтры:

1. **Environment** = `Production` (не слать sandbox-события)
2. **attribution_status** — можно фильтровать только non-organic,
   но лучше слать всё, чтобы видеть полную картину

## Шаг 5: Настройка сервера

Добавьте переменную окружения:

```env
APPHUD_SECRET_TOKEN=your-secret-token-here
```

Этот токен должен совпадать с тем, что вы указали в Header Value в Apphud.

## Шаг 6: Тестирование

### Через Apphud Dashboard:
1. В настройках Connection Builder нажмите иконку 👁️ (Preview)
2. Введите Transaction ID реальной тестовой транзакции
3. Apphud отправит тестовый POST на ваш сервер

### Проверка на сервере:
```bash
# Смотрим логи
tail -f server.log | grep APPHUD

# Проверяем статистику
curl https://your-server.com/stats
```

### Ручное тестирование:
```bash
curl -X POST https://your-server.com/apphud/webhook \
  -H "Content-Type: application/json" \
  -H "X-Apphud-Token: your-secret-token-here" \
  -d '{
    "event_id": "test-123",
    "event_name": "subscription_started",
    "product_id": "com.app.premium_monthly",
    "price_usd": 9.99,
    "proceeds_usd": 6.99,
    "currency": "USD",
    "transaction_id": "txn-test-456",
    "original_transaction_id": "txn-test-456",
    "user_id": "user-789",
    "binom_click_id": "abc123xyz",
    "treck_click_id": "550e8400-e29b-41d4-a716-446655440000",
    "attribution_status": "non-organic",
    "campaign_source": "facebook"
  }'
```

## Как это работает end-to-end

```
1. Пользователь кликает рекламу
   → GET /click → Binom click.php → binom_click_id сохраняется

2. Переходит на лендинг
   → tracker.js генерирует client_hash → POST /click/fingerprint

3. Устанавливает приложение
   → BinomTracker.trackInstall() → POST /install
   → Сервер матчит хэш → возвращает binom_click_id
   → BinomTracker прокидывает binom_click_id в Apphud user properties

4. Покупает подписку
   → Apphud обрабатывает → Connection Builder POST /apphud/webhook
   → Сервер получает binom_click_id из user_properties
   → Постбек в Binom: click.php?clickid=xxx&cnv_status=purchase&payout=6.99

5. В Binom видно:
   - Клик → Установка → Покупка (с revenue)
   - ROI считается автоматически
```
