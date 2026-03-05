import UIKit
import BinomTracker
// import ApphudSDK  ← раскомментируйте когда добавите Apphud SDK

/// Пример интеграции BinomTracker + Apphud.
///
/// Порядок инициализации:
/// 1. Apphud.start() — инициализация Apphud SDK
/// 2. BinomTracker.configure() — настройка трекера
/// 3. BinomTracker.trackInstall() — трекинг установки + автоматическая синхронизация в Apphud
///
/// При trackInstall() BinomTracker автоматически:
/// - Прокидывает binom_click_id, treck_click_id, attribution_status в Apphud user properties
/// - Устанавливает custom attribution data в Apphud
/// - Эти данные потом используются Connection Builder для постбеков при покупках
@main
class AppDelegate: UIResponder, UIApplicationDelegate {

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {

        // === Шаг 1: Инициализация Apphud (ПЕРЕД BinomTracker!) ===
        // Apphud.start(apiKey: "your_apphud_api_key")

        // === Шаг 2: Настройка BinomTracker ===
        BinomTracker.shared.configure(
            serverURL: "https://your-tracking-server.com",
            debug: true  // false в продакшене
        )

        // === Шаг 3: Трекинг установки ===
        // BinomTracker автоматически прокинет атрибуцию в Apphud:
        //   - binom_click_id → для постбеков покупок
        //   - treck_click_id → наш click_id
        //   - attribution_status → organic / non-organic
        //   - campaign_source, campaign_id и т.д.
        BinomTracker.shared.trackInstall { status in
            guard let status = status else {
                print("Не удалось отследить установку")
                return
            }

            print("Установка: \(status.status)")
            print("Метод матчинга: \(status.matchMethod)")

            if status.isNonOrganic {
                print("Рекламный трафик! Источник: \(status.campaignData["source"] ?? "unknown")")
                print("Binom click: \(status.binomClickId ?? "none")")
            }
        }

        return true
    }
}

// MARK: - Воронки на основе атрибуции

extension AppDelegate {

    /// Решаем какую воронку показать.
    /// Non-organic → рекламная воронка (более агрессивный пейволл)
    /// Organic → стандартный онбординг
    func decideOnboardingFlow() {
        BinomTracker.shared.checkStatus { status in
            DispatchQueue.main.async {
                if status.isNonOrganic {
                    self.showAdFunnel(source: status.campaignData["source"])
                } else {
                    self.showStandardOnboarding()
                }
            }
        }
    }

    func showAdFunnel(source: String?) {
        print("Рекламная воронка, источник: \(source ?? "unknown")")
        // При покупке здесь Apphud автоматически обработает транзакцию,
        // а Connection Builder пошлёт POST /apphud/webhook на наш сервер
        // с binom_click_id → постбек в Binom с revenue
    }

    func showStandardOnboarding() {
        print("Стандартный онбординг")
    }
}

// MARK: - Трекинг событий (в дополнение к Apphud)

extension AppDelegate {

    func onUserRegistered() {
        BinomTracker.shared.trackEvent(name: "registration")
    }

    func onPurchase(productId: String, amount: Double) {
        // Покупка обрабатывается Apphud → Connection Builder → наш сервер → Binom
        // Этот вызов — дополнительный прямой постбек (опционально)
        BinomTracker.shared.trackEvent(
            name: "purchase",
            value: productId,
            payout: amount
        )
    }

    func onLevelComplete(level: Int) {
        BinomTracker.shared.trackEvent(
            name: "level_complete",
            value: String(level)
        )
    }
}
