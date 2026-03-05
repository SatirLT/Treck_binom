import Foundation
import UIKit
import CommonCrypto

/// Результат проверки статуса установки.
/// Используется приложением для построения воронок (organic vs non-organic).
public struct BinomInstallStatus {
    /// "non-organic" (пришёл с рекламы) или "organic" (сам нашёл)
    public let status: String
    /// Метод матчинга (click_id, client_hash, ip_and_params, и т.д.)
    public let matchMethod: String
    /// ID клика в нашей системе (если non-organic)
    public let clickId: String?
    /// ID клика в Binom (если non-organic)
    public let binomClickId: String?
    /// Данные кампании из sub-параметров (source, campaign_id, и т.д.)
    public let campaignData: [String: String]

    public var isOrganic: Bool { status == "organic" }
    public var isNonOrganic: Bool { status == "non-organic" }
}

/// Трекер установок iOS-приложений с интеграцией в Binom.
///
/// Принцип работы:
/// 1. При первом запуске генерирует хэш устройства (тот же алгоритм, что на лендинге)
/// 2. Отправляет хэш + данные устройства на сервер
/// 3. Сервер сравнивает хэш с сохранённым хэшем от лендинга
/// 4. Если совпадает — установка привязывается к клику → постбек в Binom
/// 5. Приложение может запросить статус: Organic / Non-Organic
public final class BinomTracker {

    public static let shared = BinomTracker()

    // MARK: - Configuration

    private var serverURL: String = ""
    private var bundleId: String = ""
    private var isConfigured = false
    private var isDebug = false

    /// Закэшированный статус (чтобы не ходить на сервер каждый раз)
    private var cachedStatus: BinomInstallStatus?

    private let installKey = "com.binomtracker.installed"
    private let clickIdKey = "com.binomtracker.click_id"
    private let deviceIdKey = "com.binomtracker.device_id"
    private let statusKey = "com.binomtracker.status"
    private let matchMethodKey = "com.binomtracker.match_method"

    private init() {}

    /// Настроить трекер. Вызывать в application(_:didFinishLaunchingWithOptions:).
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
    /// Формат строки: "screenW|screenH|lang|timezone|osVersion|dpr"
    ///
    /// Примеры:
    ///   iPhone 15 Pro: "1179|2556|ru|Europe/Moscow|17.2|3"
    ///   iPhone SE 3:   "750|1334|en|America/New_York|17.2|2"
    private func generateClientHash() -> String {
        let screen = UIScreen.main

        // Реальные пиксели экрана (bounds * scale)
        let screenW = Int(screen.bounds.width * screen.scale)
        let screenH = Int(screen.bounds.height * screen.scale)

        // Язык — только код (2 символа)
        let lang = (Locale.current.languageCode ?? "en").lowercased()

        // Часовой пояс
        let timezone = TimeZone.current.identifier

        // Версия iOS — major.minor (без patch, т.к. может обновиться между кликом и установкой)
        let fullVersion = UIDevice.current.systemVersion // "17.2.1"
        let versionParts = fullVersion.split(separator: ".")
        let osVersion: String
        if versionParts.count >= 2 {
            osVersion = "\(versionParts[0]).\(versionParts[1])" // "17.2"
        } else {
            osVersion = fullVersion
        }

        // Device Pixel Ratio (2 или 3)
        let dpr = String(Int(screen.scale))

        let raw = "\(screenW)|\(screenH)|\(lang)|\(timezone)|\(osVersion)|\(dpr)"
        log("Hash input: \(raw)")

        let hash = sha256(raw)
        return String(hash.prefix(32))
    }

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
    ///
    /// Completion возвращает BinomInstallStatus — используйте его для воронок.
    /// Если интегрирован Apphud — автоматически прокинет атрибуцию.
    public func trackInstall(completion: ((BinomInstallStatus?) -> Void)? = nil) {
        guard isConfigured else {
            log("Error: BinomTracker not configured. Call configure() first.")
            completion?(nil)
            return
        }

        // Если уже трекали — возвращаем закэшированный статус
        if UserDefaults.standard.bool(forKey: installKey) {
            log("Install already tracked, returning cached status")
            let status = getCachedStatus()
            completion?(status)
            return
        }

        // Собираем данные устройства
        var params = collectDeviceData()

        // Генерируем клиентский хэш
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
            self.sendRequest(endpoint: "/install", params: params) { [weak self] success, responseData in
                guard let self = self else { return }

                var installStatus: BinomInstallStatus?

                if success, let data = responseData {
                    UserDefaults.standard.set(true, forKey: self.installKey)

                    // Парсим ответ сервера
                    installStatus = self.parseInstallResponse(data)

                    // Кэшируем статус
                    if let status = installStatus {
                        self.cacheStatus(status)
                        // Прокидываем атрибуцию в Apphud
                        self.syncToApphud(status: status)
                    }

                    self.log("Install tracked: \(installStatus?.status ?? "unknown")")
                }

                completion?(installStatus)
            }
        }
    }

    // MARK: - Apphud Integration

    /// Прокидывает данные атрибуции в Apphud через setAttribution и setUserProperty.
    ///
    /// Apphud Connection Builder использует user_properties для формирования
    /// вебхуков на наш сервер. Так покупки в Apphud связываются с кликами в Binom.
    ///
    /// Устанавливаемые свойства:
    ///   - binom_click_id → для постбека в Binom при покупке
    ///   - treck_click_id → наш внутренний click_id
    ///   - attribution_status → "non-organic" / "organic"
    ///   - match_method → как сматчили (client_hash, click_id, и т.д.)
    ///   - campaign_source → источник из sub-параметров
    private func syncToApphud(status: BinomInstallStatus) {
        // Проверяем, доступен ли Apphud SDK (runtime check, без жёсткой зависимости)
        guard let apphudClass = NSClassFromString("Apphud") else {
            log("Apphud SDK not found, skipping attribution sync")
            return
        }

        log("Syncing attribution to Apphud...")

        // 1. Ставим User Properties — они будут доступны через
        //    {{ user.user_properties.binom_click_id }} в Connection Builder
        let properties: [(String, String?)] = [
            ("binom_click_id", status.binomClickId),
            ("treck_click_id", status.clickId),
            ("attribution_status", status.status),
            ("match_method", status.matchMethod),
            ("campaign_source", status.campaignData["source"]),
            ("campaign_id", status.campaignData["campaign_id"]),
            ("creative_id", status.campaignData["creative_id"]),
            ("adset_id", status.campaignData["adset_id"]),
            ("treck_device_id", getDeviceId()),
        ]

        for (key, value) in properties {
            guard let value = value, !value.isEmpty else { continue }
            setApphudUserProperty(apphudClass: apphudClass, key: key, value: value)
        }

        // 2. Прокидываем custom attribution data — появится в Apphud Charts
        var attributionData: [String: Any] = [
            "attribution_status": status.status,
            "match_method": status.matchMethod,
        ]
        if let clickId = status.clickId {
            attributionData["click_id"] = clickId
        }
        if let binomClickId = status.binomClickId {
            attributionData["binom_click_id"] = binomClickId
        }
        for (key, value) in status.campaignData {
            attributionData[key] = value
        }

        setApphudAttribution(apphudClass: apphudClass, data: attributionData)

        log("Attribution synced to Apphud: \(attributionData)")
    }

    /// Вызывает Apphud.setUserProperty(key:value:setOnce:) через Objective-C runtime.
    /// Это позволяет не добавлять жёсткую зависимость на ApphudSDK.
    private func setApphudUserProperty(apphudClass: AnyClass, key: String, value: String) {
        let selector = NSSelectorFromString("setUserPropertyWithKey:value:setOnce:")
        guard let method = class_getClassMethod(apphudClass, selector) else {
            // Fallback: пробуем через perform
            let sel2 = NSSelectorFromString("setUserProperty:value:setOnce:")
            if apphudClass.responds(to: sel2) {
                _ = (apphudClass as AnyObject).perform(sel2, with: key, with: value)
            }
            return
        }
        let imp = method_getImplementation(method)
        typealias Function = @convention(c) (AnyObject, Selector, Any, Any, Bool) -> Void
        let function = unsafeBitCast(imp, to: Function.self)
        function(apphudClass, selector, key, value, true)
    }

    /// Вызывает Apphud.setAttribution(data:from:identifier:) через runtime.
    private func setApphudAttribution(apphudClass: AnyClass, data: [String: Any]) {
        // ApphudAttributionProvider.custom = 5 (enum value)
        let selector = NSSelectorFromString("setAttributionWithData:from:identifier:callback:")
        if apphudClass.responds(to: selector) {
            _ = (apphudClass as AnyObject).perform(selector, with: data, with: NSNumber(value: 5))
        }
    }

    // MARK: - Status Check

    /// Проверить статус установки: Organic или Non-Organic.
    ///
    /// Сначала проверяет локальный кэш, потом идёт на сервер.
    /// Используйте для построения воронок внутри приложения.
    ///
    /// Пример:
    /// ```
    /// BinomTracker.shared.checkStatus { status in
    ///     if status.isNonOrganic {
    ///         // Показываем воронку для рекламного трафика
    ///     } else {
    ///         // Показываем стандартный онбординг
    ///     }
    /// }
    /// ```
    public func checkStatus(completion: @escaping (BinomInstallStatus) -> Void) {
        guard isConfigured else {
            log("Error: BinomTracker not configured")
            completion(BinomInstallStatus(
                status: "organic", matchMethod: "none",
                clickId: nil, binomClickId: nil, campaignData: [:]
            ))
            return
        }

        // Сначала проверяем кэш
        if let cached = cachedStatus {
            completion(cached)
            return
        }

        // Проверяем UserDefaults
        if let cached = getCachedStatus() {
            self.cachedStatus = cached
            completion(cached)
            return
        }

        // Идём на сервер
        let params: [String: String] = [
            "device_id": getDeviceId(),
            "idfv": UIDevice.current.identifierForVendor?.uuidString ?? "",
            "client_hash": generateClientHash(),
        ]

        sendRequest(endpoint: "/status", params: params) { [weak self] success, responseData in
            guard let self = self else { return }

            if success, let data = responseData {
                if let status = self.parseStatusResponse(data) {
                    self.cachedStatus = status
                    self.cacheStatus(status)
                    completion(status)
                    return
                }
            }

            // Если сервер недоступен — считаем organic
            let fallback = BinomInstallStatus(
                status: "organic", matchMethod: "none",
                clickId: nil, binomClickId: nil, campaignData: [:]
            )
            completion(fallback)
        }
    }

    // MARK: - Event Tracking

    /// Трекинг in-app события (регистрация, покупка и т.д.).
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

        sendRequest(endpoint: "/event", params: params) { [weak self] success, _ in
            self?.log("Event '\(name)' tracked: \(success)")
            completion?(success)
        }
    }

    // MARK: - Response Parsing

    private func parseInstallResponse(_ data: Data) -> BinomInstallStatus? {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }

        let matched = json["matched"] as? Bool ?? false
        let matchMethod = json["match_method"] as? String ?? "none"
        let status = matched ? "non-organic" : "organic"
        let clickId = json["click_id"] as? String
        let binomClickId = json["binom_click_id"] as? String
        let campaignData = json["campaign_data"] as? [String: String] ?? [:]

        return BinomInstallStatus(
            status: status,
            matchMethod: matchMethod,
            clickId: clickId,
            binomClickId: binomClickId,
            campaignData: campaignData
        )
    }

    private func parseStatusResponse(_ data: Data) -> BinomInstallStatus? {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }

        let status = json["status"] as? String ?? "organic"
        let matchMethod = json["match_method"] as? String ?? "none"
        let clickId = json["click_id"] as? String
        let binomClickId = json["binom_click_id"] as? String
        let campaignData = json["campaign_data"] as? [String: String] ?? [:]

        return BinomInstallStatus(
            status: status,
            matchMethod: matchMethod,
            clickId: clickId,
            binomClickId: binomClickId,
            campaignData: campaignData
        )
    }

    // MARK: - Status Cache

    private func cacheStatus(_ status: BinomInstallStatus) {
        UserDefaults.standard.set(status.status, forKey: statusKey)
        UserDefaults.standard.set(status.matchMethod, forKey: matchMethodKey)
        if let clickId = status.clickId {
            UserDefaults.standard.set(clickId, forKey: clickIdKey)
        }
    }

    private func getCachedStatus() -> BinomInstallStatus? {
        guard let status = UserDefaults.standard.string(forKey: statusKey) else {
            return nil
        }
        let matchMethod = UserDefaults.standard.string(forKey: matchMethodKey) ?? "none"
        let clickId = UserDefaults.standard.string(forKey: clickIdKey)

        return BinomInstallStatus(
            status: status,
            matchMethod: matchMethod,
            clickId: clickId,
            binomClickId: nil,
            campaignData: [:]
        )
    }

    // MARK: - Device Data Collection

    private func collectDeviceData() -> [String: String] {
        let device = UIDevice.current
        let screen = UIScreen.main

        // iOS version — major.minor
        let fullVersion = device.systemVersion
        let versionParts = fullVersion.split(separator: ".")
        let osVersionShort: String
        if versionParts.count >= 2 {
            osVersionShort = "\(versionParts[0]).\(versionParts[1])"
        } else {
            osVersionShort = fullVersion
        }

        return [
            "device_id": getDeviceId(),
            "idfv": device.identifierForVendor?.uuidString ?? "",
            "bundle_id": bundleId,
            "app_version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "",
            "os_version": osVersionShort,
            "os_version_full": fullVersion,
            "device_model": getDeviceModel(),
            "screen_width": String(Int(screen.bounds.width * screen.scale)),
            "screen_height": String(Int(screen.bounds.height * screen.scale)),
            "dpr": String(Int(screen.scale)),
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

    private func retrieveClickId(completion: @escaping (String?) -> Void) {
        DispatchQueue.main.async {
            guard UIPasteboard.general.hasStrings else {
                completion(nil)
                return
            }

            let content = UIPasteboard.general.string ?? ""
            if content.hasPrefix("treck:") {
                let clickId = String(content.dropFirst(6))
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

    private func sendRequest(endpoint: String, params: [String: String], completion: @escaping (Bool, Data?) -> Void) {
        guard let url = URL(string: serverURL + endpoint) else {
            log("Invalid URL: \(serverURL + endpoint)")
            completion(false, nil)
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
            completion(false, nil)
            return
        }

        log("Sending \(endpoint): \(params)")

        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            if let error = error {
                self?.log("Request error: \(error.localizedDescription)")
                completion(false, nil)
                return
            }

            guard let httpResponse = response as? HTTPURLResponse else {
                completion(false, nil)
                return
            }

            let success = (200...299).contains(httpResponse.statusCode)
            if !success {
                self?.log("Server error: \(httpResponse.statusCode)")
            }

            if let data = data, let body = String(data: data, encoding: .utf8) {
                self?.log("Response: \(body)")
            }

            completion(success, data)
        }.resume()
    }

    // MARK: - Logging

    private func log(_ message: String) {
        if isDebug {
            print("[BinomTracker] \(message)")
        }
    }
}
