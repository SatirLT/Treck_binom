import Foundation
import UIKit
import CommonCrypto

/// Трекер установок iOS-приложений с интеграцией в Binom.
///
/// Принцип работы:
/// 1. При первом запуске генерирует хэш устройства (тот же алгоритм, что на лендинге)
/// 2. Отправляет хэш + данные устройства на сервер
/// 3. Сервер сравнивает хэш с сохранённым хэшем от лендинга
/// 4. Если совпадает — установка привязывается к клику → постбек в Binom
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

    /// Настроить трекер. Вызывать в application(_:didFinishLaunchingWithOptions:).
    /// - Parameters:
    ///   - serverURL: URL вашего сервера трекинга (например, "https://your-server.com")
    ///   - debug: Включить отладочные логи
    public func configure(serverURL: String, debug: Bool = false) {
        self.serverURL = serverURL.hasSuffix("/") ? String(serverURL.dropLast()) : serverURL
        self.bundleId = Bundle.main.bundleIdentifier ?? ""
        self.isDebug = debug
        self.isConfigured = true

        log("BinomTracker configured: \(self.serverURL)")
    }

    // MARK: - Client Hash Generation

    /// Генерирует клиентский хэш устройства.
    ///
    /// ВАЖНО: Этот же алгоритм используется в landing/tracker.js.
    /// Формат строки: "screenW|screenH|lang|timezone"
    ///
    /// Примеры:
    ///   iPhone 15 Pro: "1179|2556|ru|Europe/Moscow"
    ///   iPhone 14:     "1170|2532|en|America/New_York"
    private func generateClientHash() -> String {
        let screen = UIScreen.main
        // Реальные пиксели экрана (bounds * scale) — как screen.width * devicePixelRatio в JS
        let screenW = Int(screen.bounds.width * screen.scale)
        let screenH = Int(screen.bounds.height * screen.scale)

        // Язык — только код языка (2 символа), как lang.split('-')[0] в JS
        let lang = (Locale.current.languageCode ?? "en").lowercased()

        // Часовой пояс — идентичен в Safari и iOS
        let timezone = TimeZone.current.identifier

        let raw = "\(screenW)|\(screenH)|\(lang)|\(timezone)"
        log("Hash input: \(raw)")

        let hash = sha256(raw)
        // Первые 32 символа (128 бит) — как в JS
        return String(hash.prefix(32))
    }

    /// SHA-256 хэш строки → hex-строка.
    private func sha256(_ string: String) -> String {
        let data = Data(string.utf8)
        var hash = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
        data.withUnsafeBytes {
            _ = CC_SHA256($0.baseAddress, CC_LONG(data.count), &hash)
        }
        return hash.map { String(format: "%02x", $0) }.joined()
    }

    // MARK: - Install Tracking

    /// Трекинг установки. Вызывать после configure() при запуске приложения.
    /// Отправляет постбек только один раз (при первом запуске после установки).
    public func trackInstall(completion: ((Bool) -> Void)? = nil) {
        guard isConfigured else {
            log("Error: BinomTracker not configured. Call configure() first.")
            completion?(false)
            return
        }

        // Проверяем, не трекали ли уже
        if UserDefaults.standard.bool(forKey: installKey) {
            log("Install already tracked, skipping")
            completion?(true)
            return
        }

        // Собираем данные устройства
        var params = collectDeviceData()

        // Генерируем клиентский хэш (тот же алгоритм, что на лендинге)
        let clientHash = generateClientHash()
        params["client_hash"] = clientHash
        log("Client hash: \(clientHash)")

        // Пытаемся достать click_id из буфера обмена
        retrieveClickId { [weak self] clickId in
            guard let self = self else { return }

            if let clickId = clickId {
                params["click_id"] = clickId
                self.saveClickId(clickId)
                self.log("Click ID from clipboard: \(clickId)")
            }

            // Отправляем на сервер
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

    /// Трекинг in-app события (регистрация, покупка и т.д.).
    /// - Parameters:
    ///   - name: Имя события (например, "registration", "purchase")
    ///   - value: Опциональное значение события
    ///   - payout: Опциональная сумма (для revenue-событий)
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
            "language": (Locale.current.languageCode ?? "en").lowercased(),
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

    /// Пытаемся прочитать click_id из буфера обмена (туда его записал лендинг).
    private func retrieveClickId(completion: @escaping (String?) -> Void) {
        DispatchQueue.main.async {
            guard UIPasteboard.general.hasStrings else {
                completion(nil)
                return
            }

            let content = UIPasteboard.general.string ?? ""
            if content.hasPrefix("treck:") {
                let clickId = String(content.dropFirst(6))
                // Очищаем буфер обмена
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
