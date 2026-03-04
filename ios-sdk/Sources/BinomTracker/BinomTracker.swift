import Foundation
import UIKit

/// Main tracker class for Binom iOS install tracking.
/// Handles install attribution, event tracking, and postback communication.
public final class BinomTracker {

    public static let shared = BinomTracker()

    // MARK: - Configuration

    private var serverURL: String = ""
    private var bundleId: String = ""
    private var isConfigured = false
    private var isDebug = false

    private let installKey = "com.binomtracker.installed"
    private let clickIdKey = "com.binomtracker.click_id"
    private let deviceIdKey = "com.binomtracker.device_id"

    private init() {}

    /// Configure the tracker. Call this in application(_:didFinishLaunchingWithOptions:).
    /// - Parameters:
    ///   - serverURL: Your tracking server URL (e.g., "https://your-server.com")
    ///   - debug: Enable debug logging
    public func configure(serverURL: String, debug: Bool = false) {
        self.serverURL = serverURL.hasSuffix("/") ? String(serverURL.dropLast()) : serverURL
        self.bundleId = Bundle.main.bundleIdentifier ?? ""
        self.isDebug = debug
        self.isConfigured = true

        log("BinomTracker configured: \(self.serverURL)")
    }

    // MARK: - Install Tracking

    /// Track app install. Call this after configure() in didFinishLaunchingWithOptions.
    /// Only sends the install postback once (first launch after install).
    public func trackInstall(completion: ((Bool) -> Void)? = nil) {
        guard isConfigured else {
            log("Error: BinomTracker not configured. Call configure() first.")
            completion?(false)
            return
        }

        // Check if already tracked
        if UserDefaults.standard.bool(forKey: installKey) {
            log("Install already tracked, skipping")
            completion?(true)
            return
        }

        // Collect device data
        let deviceData = collectDeviceData()

        // Try to retrieve click_id from clipboard
        retrieveClickId { [weak self] clickId in
            guard let self = self else { return }

            var params = deviceData
            if let clickId = clickId {
                params["click_id"] = clickId
                self.saveClickId(clickId)
            }

            // Send install data to server
            self.sendRequest(endpoint: "/install", params: params) { success in
                if success {
                    UserDefaults.standard.set(true, forKey: self.installKey)
                    self.log("Install tracked successfully")
                }
                completion?(success)
            }
        }
    }

    // MARK: - Event Tracking

    /// Track an in-app event (registration, purchase, etc.).
    /// - Parameters:
    ///   - name: Event name (e.g., "registration", "purchase", "level_complete")
    ///   - value: Optional event value
    ///   - payout: Optional payout value for revenue events
    public func trackEvent(name: String, value: String? = nil, payout: Double? = nil, completion: ((Bool) -> Void)? = nil) {
        guard isConfigured else {
            log("Error: BinomTracker not configured")
            completion?(false)
            return
        }

        var params: [String: String] = [
            "device_id": getDeviceId(),
            "idfv": UIDevice.current.identifierForVendor?.uuidString ?? "",
            "event_name": name,
        ]

        if let value = value {
            params["event_value"] = value
        }
        if let payout = payout {
            params["payout"] = String(payout)
        }

        sendRequest(endpoint: "/event", params: params) { [weak self] success in
            self?.log("Event '\(name)' tracked: \(success)")
            completion?(success)
        }
    }

    // MARK: - Device Data Collection

    private func collectDeviceData() -> [String: String] {
        let device = UIDevice.current
        let screen = UIScreen.main

        return [
            "device_id": getDeviceId(),
            "idfv": device.identifierForVendor?.uuidString ?? "",
            "bundle_id": bundleId,
            "app_version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "",
            "os_version": device.systemVersion,
            "device_model": getDeviceModel(),
            "screen_width": String(Int(screen.bounds.width * screen.scale)),
            "screen_height": String(Int(screen.bounds.height * screen.scale)),
            "language": Locale.current.languageCode ?? "",
            "timezone": TimeZone.current.identifier,
        ]
    }

    private func getDeviceModel() -> String {
        var systemInfo = utsname()
        uname(&systemInfo)
        let machineMirror = Mirror(reflecting: systemInfo.machine)
        return machineMirror.children.reduce("") { identifier, element in
            guard let value = element.value as? Int8, value != 0 else { return identifier }
            return identifier + String(UnicodeScalar(UInt8(value)))
        }
    }

    // MARK: - Device ID Management

    private func getDeviceId() -> String {
        if let stored = UserDefaults.standard.string(forKey: deviceIdKey) {
            return stored
        }
        let newId = UUID().uuidString
        UserDefaults.standard.set(newId, forKey: deviceIdKey)
        return newId
    }

    // MARK: - Click ID Retrieval

    /// Try to get click_id from clipboard (set by landing page).
    private func retrieveClickId(completion: @escaping (String?) -> Void) {
        DispatchQueue.main.async {
            guard UIPasteboard.general.hasStrings else {
                completion(nil)
                return
            }

            let content = UIPasteboard.general.string ?? ""
            if content.hasPrefix("treck:") {
                let clickId = String(content.dropFirst(6))
                self.log("Click ID from clipboard: \(clickId)")
                // Clear clipboard to be clean
                UIPasteboard.general.string = ""
                completion(clickId)
            } else {
                completion(nil)
            }
        }
    }

    private func saveClickId(_ clickId: String) {
        UserDefaults.standard.set(clickId, forKey: clickIdKey)
    }

    // MARK: - Networking

    private func sendRequest(endpoint: String, params: [String: String], completion: @escaping (Bool) -> Void) {
        guard let url = URL(string: serverURL + endpoint) else {
            log("Invalid URL: \(serverURL + endpoint)")
            completion(false)
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 10

        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: params)
        } catch {
            log("JSON serialization error: \(error)")
            completion(false)
            return
        }

        log("Sending \(endpoint): \(params)")

        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            if let error = error {
                self?.log("Request error: \(error.localizedDescription)")
                completion(false)
                return
            }

            guard let httpResponse = response as? HTTPURLResponse else {
                completion(false)
                return
            }

            let success = (200...299).contains(httpResponse.statusCode)
            if !success {
                self?.log("Server error: \(httpResponse.statusCode)")
            }

            if let data = data, let body = String(data: data, encoding: .utf8) {
                self?.log("Response: \(body)")
            }

            completion(success)
        }.resume()
    }

    // MARK: - Logging

    private func log(_ message: String) {
        if isDebug {
            print("[BinomTracker] \(message)")
        }
    }
}
