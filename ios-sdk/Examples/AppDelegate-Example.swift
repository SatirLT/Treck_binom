import UIKit
import BinomTracker

/// Пример интеграции BinomTracker в приложение.
/// Скопируйте нужные части в свой AppDelegate.
@main
class AppDelegate: UIResponder, UIApplicationDelegate {

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {

        // Шаг 1: Настраиваем трекер
        BinomTracker.shared.configure(
            serverURL: "https://your-tracking-server.com",
            debug: true  // false в продакшене
        )

        // Шаг 2: Трекаем установку (сработает 1 раз)
        // Возвращает статус: organic / non-organic
        BinomTracker.shared.trackInstall { status in
            guard let status = status else {
                print("Не удалось отследить установку")
                return
            }

            print("Установка: \(status.status)")          // "organic" или "non-organic"
            print("Метод матчинга: \(status.matchMethod)") // "client_hash", "click_id" и т.д.

            if status.isNonOrganic {
                print("Пришёл с рекламы! Источник: \(status.campaignData["source"] ?? "unknown")")
            }
        }

        return true
    }
}

// MARK: - Проверка статуса для воронок

extension AppDelegate {

    /// Вызывайте в нужный момент, чтобы решить какую воронку показать.
    /// Например, на экране онбординга.
    func decideOnboardingFlow() {
        BinomTracker.shared.checkStatus { status in
            DispatchQueue.main.async {
                if status.isNonOrganic {
                    // Пользователь пришёл с рекламы →
                    // показываем воронку для рекламного трафика
                    self.showAdFunnel(source: status.campaignData["source"])
                } else {
                    // Organic пользователь →
                    // стандартный онбординг
                    self.showStandardOnboarding()
                }
            }
        }
    }

    func showAdFunnel(source: String?) {
        // Ваш код для рекламной воронки
        print("Показываем рекламную воронку, источник: \(source ?? "unknown")")
    }

    func showStandardOnboarding() {
        // Ваш код для обычного онбординга
        print("Показываем стандартный онбординг")
    }
}

// MARK: - Трекинг событий

extension AppDelegate {

    /// После регистрации
    func onUserRegistered() {
        BinomTracker.shared.trackEvent(name: "registration")
    }

    /// После покупки
    func onPurchase(productId: String, amount: Double) {
        BinomTracker.shared.trackEvent(
            name: "purchase",
            value: productId,
            payout: amount
        )
    }

    /// Любое кастомное событие
    func onLevelComplete(level: Int) {
        BinomTracker.shared.trackEvent(
            name: "level_complete",
            value: String(level)
        )
    }
}
