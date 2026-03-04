import UIKit
import BinomTracker

/// Example AppDelegate showing BinomTracker integration.
/// Copy the relevant parts to your app's AppDelegate.
@main
class AppDelegate: UIResponder, UIApplicationDelegate {

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {

        // Step 1: Configure tracker with your server URL
        BinomTracker.shared.configure(
            serverURL: "https://your-tracking-server.com",
            debug: true  // Set to false in production
        )

        // Step 2: Track install (only fires on first launch)
        BinomTracker.shared.trackInstall { success in
            print("Install tracked: \(success)")
        }

        return true
    }
}

// MARK: - Event Tracking Examples

extension AppDelegate {

    /// Call after user completes registration
    func onUserRegistered() {
        BinomTracker.shared.trackEvent(name: "registration")
    }

    /// Call after in-app purchase
    func onPurchase(productId: String, amount: Double) {
        BinomTracker.shared.trackEvent(
            name: "purchase",
            value: productId,
            payout: amount
        )
    }

    /// Call on any custom event
    func onLevelComplete(level: Int) {
        BinomTracker.shared.trackEvent(
            name: "level_complete",
            value: String(level)
        )
    }
}
