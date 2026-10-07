import ExpoModulesCore
import UIKit

/// Native half of the papercut report (docs/fork/papercuts.md).
///
/// A report has to work when the JavaScript thread is blocked, which is the
/// state the iPad hang reports describe. So the shake gesture is caught here,
/// the screenshot and a bundle of the last context JavaScript handed over are
/// written to disk immediately, and JavaScript uploads the bundle whenever it
/// next runs. `heartbeat` is what tells the two cases apart: it is called by a
/// JavaScript timer, so its age at shake time is how long JavaScript has been
/// unresponsive.
public final class T3PapercutModule: Module {
  public func definition() -> ModuleDefinition {
    Name("T3Papercut")

    Events("onShake")

    OnCreate {
      T3PapercutStore.shared.installShakeHandler { [weak self] id in
        self?.sendEvent("onShake", ["id": id])
      }
    }

    Function("heartbeat") {
      T3PapercutStore.shared.markHeartbeat()
    }

    /// The JSON JavaScript wants a later bundle to carry. Replaced, never appended.
    Function("setContext") { (json: String) in
      T3PapercutStore.shared.setContext(json)
    }

    /// Writes a bundle for a report started from a menu item, not a shake.
    AsyncFunction("capture") { (trigger: String) -> String in
      T3PapercutStore.shared.capture(trigger: trigger)
    }.runOnQueue(.main)

    AsyncFunction("listPending") { () -> [String] in
      T3PapercutStore.shared.pendingIds()
    }

    AsyncFunction("readPending") { (id: String) -> String? in
      T3PapercutStore.shared.readBundle(id: id)
    }

    AsyncFunction("discardPending") { (id: String) in
      T3PapercutStore.shared.discard(id: id)
    }

    /// Keeps a note typed for a report whose upload failed, so the retry still has it.
    AsyncFunction("setNote") { (id: String, note: String) in
      T3PapercutStore.shared.setNote(id: id, note: note)
    }
  }
}

/// A heartbeat older than this means JavaScript is not running.
private let staleHeartbeatSeconds: TimeInterval = 3
private let shakeCooldownSeconds: TimeInterval = 3
private let pendingRetentionSeconds: TimeInterval = 7 * 24 * 60 * 60
private let screenshotJPEGQuality: CGFloat = 0.6

final class T3PapercutStore {
  static let shared = T3PapercutStore()

  private let lock = NSLock()
  private var lastHeartbeat = ProcessInfo.processInfo.systemUptime
  private var contextJson: String?
  private var lastShakeAt: TimeInterval = 0
  private var onShake: ((String) -> Void)?
  private var installed = false

  /// Created in `init`, not lazily: the main thread (shake) and the module queue
  /// (`listPending`) can both need it first.
  private let directory: URL

  private init() {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    directory = base.appendingPathComponent("t3-papercuts", isDirectory: true)
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  }

  func markHeartbeat() {
    lock.lock()
    lastHeartbeat = ProcessInfo.processInfo.systemUptime
    lock.unlock()
  }

  func setContext(_ json: String) {
    lock.lock()
    contextJson = json
    lock.unlock()
  }

  private func heartbeatAgeMs() -> Int {
    lock.lock()
    defer { lock.unlock() }
    return Int(max(0, ProcessInfo.processInfo.systemUptime - lastHeartbeat) * 1000)
  }

  // MARK: Shake

  func installShakeHandler(_ handler: @escaping (String) -> Void) {
    lock.lock()
    onShake = handler
    let alreadyInstalled = installed
    installed = true
    lock.unlock()
    if alreadyInstalled { return }

    DispatchQueue.main.async {
      // The system's "Undo Typing" sheet would otherwise take the gesture
      // whenever a text field has edits.
      UIApplication.shared.applicationSupportsShakeToEdit = false
      UIWindow.t3InstallShakeHook()
      // Timers do not run while the app is in the background, so the age
      // after a long absence is meaningless until JavaScript ticks again.
      NotificationCenter.default.addObserver(
        forName: UIApplication.didBecomeActiveNotification,
        object: nil,
        queue: .main
      ) { _ in T3PapercutStore.shared.markHeartbeat() }
    }
  }

  func handleShake() {
    let now = ProcessInfo.processInfo.systemUptime
    lock.lock()
    let cooledDown = now - lastShakeAt > shakeCooldownSeconds
    if cooledDown { lastShakeAt = now }
    let handler = onShake
    lock.unlock()
    guard cooledDown else { return }

    UINotificationFeedbackGenerator().notificationOccurred(.success)
    let bundle = writeBundle(trigger: "shake")
    if bundle.heartbeatAgeMs > Int(staleHeartbeatSeconds * 1000) {
      presentSavedAlert()
    } else {
      handler?(bundle.id)
    }
  }

  private func presentSavedAlert() {
    guard var top = Self.keyWindow()?.rootViewController else { return }
    while let presented = top.presentedViewController { top = presented }
    if top is UIAlertController { return }
    let alert = UIAlertController(
      title: "Papercut saved on this device",
      message: "The app was not responding. The report uploads when it recovers.",
      preferredStyle: .alert
    )
    alert.addAction(UIAlertAction(title: "OK", style: .default))
    top.present(alert, animated: true)
  }

  // MARK: Bundles

  /// Called on the main queue; `drawHierarchy` needs it.
  func capture(trigger: String) -> String {
    writeBundle(trigger: trigger).id
  }

  private func writeBundle(trigger: String) -> (id: String, heartbeatAgeMs: Int) {
    let id = UUID().uuidString.lowercased()
    let ageMs = heartbeatAgeMs()
    lock.lock()
    let context = contextJson
    lock.unlock()

    var screenshotFile: String?
    if let jpeg = Self.screenshotJPEG() {
      let name = "\(id).jpg"
      if (try? jpeg.write(to: directory.appendingPathComponent(name), options: .atomic)) != nil {
        screenshotFile = name
      }
    }

    var bundle: [String: Any] = [
      "id": id,
      "trigger": trigger,
      "capturedAtMs": Int(Date().timeIntervalSince1970 * 1000),
      "jsHeartbeatAgeMs": ageMs,
      "device": [
        "model": Self.deviceModel(),
        "systemVersion": UIDevice.current.systemVersion,
      ],
    ]
    if let context { bundle["context"] = context }
    if let screenshotFile { bundle["screenshotFile"] = screenshotFile }
    let wrote = (try? JSONSerialization.data(withJSONObject: bundle))
      .flatMap { try? $0.write(to: directory.appendingPathComponent("\(id).json"), options: .atomic) } != nil
    // Without its JSON a screenshot would never be listed, so it would never be removed.
    if !wrote { try? FileManager.default.removeItem(at: directory.appendingPathComponent("\(id).jpg")) }
    return (id, ageMs)
  }

  func pendingIds() -> [String] {
    let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
    let cutoff = Date().addingTimeInterval(-pendingRetentionSeconds)
    var ids: [String] = []
    for file in files where file.pathExtension == "json" {
      let modified = (try? file.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
      if let modified, modified < cutoff {
        discard(id: file.deletingPathExtension().lastPathComponent)
      } else {
        ids.append(file.deletingPathExtension().lastPathComponent)
      }
    }
    return ids.sorted()
  }

  /// The bundle JSON with the screenshot inlined as base64, or nil when it is gone.
  func readBundle(id: String) -> String? {
    guard
      let data = try? Data(contentsOf: directory.appendingPathComponent("\(id).json")),
      var bundle = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    else { return nil }
    if let file = bundle.removeValue(forKey: "screenshotFile") as? String,
       let jpeg = try? Data(contentsOf: directory.appendingPathComponent(file)) {
      bundle["screenshot"] = ["mimeType": "image/jpeg", "dataBase64": jpeg.base64EncodedString()]
    }
    guard let out = try? JSONSerialization.data(withJSONObject: bundle) else { return nil }
    return String(data: out, encoding: .utf8)
  }

  func setNote(id: String, note: String) {
    let file = directory.appendingPathComponent("\(id).json")
    guard
      let data = try? Data(contentsOf: file),
      var bundle = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    else { return }
    bundle["note"] = note
    if let out = try? JSONSerialization.data(withJSONObject: bundle) {
      try? out.write(to: file, options: .atomic)
    }
  }

  func discard(id: String) {
    try? FileManager.default.removeItem(at: directory.appendingPathComponent("\(id).json"))
    try? FileManager.default.removeItem(at: directory.appendingPathComponent("\(id).jpg"))
  }

  // MARK: Device

  static func keyWindow() -> UIWindow? {
    UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
      .first { $0.isKeyWindow }
  }

  private static func screenshotJPEG() -> Data? {
    guard let window = keyWindow() else { return nil }
    let bounds = window.bounds
    // One pixel per point is legible for a UI screenshot and keeps the upload small.
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true
    let image = UIGraphicsImageRenderer(size: bounds.size, format: format).image { _ in
      // No layout pass: this must not wait on a busy main thread more than it has to.
      window.drawHierarchy(in: bounds, afterScreenUpdates: false)
    }
    return image.jpegData(compressionQuality: screenshotJPEGQuality)
  }

  private static func deviceModel() -> String {
    if let simulated = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] {
      return simulated
    }
    var info = utsname()
    uname(&info)
    return withUnsafePointer(to: &info.machine) {
      $0.withMemoryRebound(to: CChar.self, capacity: 1) { String(cString: $0) }
    }
  }
}

extension UIWindow {
  /// Adds a shake observer to `UIWindow.motionEnded` without disturbing the
  /// original behavior, the same hook React Native's dev menu uses.
  fileprivate static func t3InstallShakeHook() {
    let originalSelector = #selector(UIWindow.motionEnded(_:with:))
    let swizzledSelector = #selector(UIWindow.t3MotionEnded(_:with:))
    guard
      let original = class_getInstanceMethod(UIWindow.self, originalSelector),
      let swizzled = class_getInstanceMethod(UIWindow.self, swizzledSelector)
    else { return }
    // The original is called by IMP under its own selector, never renamed:
    // UIKit's inherited `motionEnded` is a forwarding trampoline keyed on the
    // selector it is invoked with, so calling it as `t3MotionEnded` forwards
    // an unrecognized selector up the responder chain and aborts.
    t3OriginalMotionEnded = method_getImplementation(original)
    // `motionEnded` is inherited from UIResponder, so add it to UIWindow first;
    // exchanging implementations would otherwise patch every responder.
    if !class_addMethod(
      UIWindow.self,
      originalSelector,
      method_getImplementation(swizzled),
      method_getTypeEncoding(swizzled)
    ) {
      method_exchangeImplementations(original, swizzled)
    }
  }

  @objc dynamic fileprivate func t3MotionEnded(_ motion: UIEvent.EventSubtype, with event: UIEvent?) {
    if let original = t3OriginalMotionEnded {
      typealias MotionEndedIMP = @convention(c) (AnyObject, Selector, Int, UIEvent?) -> Void
      let callOriginal = unsafeBitCast(original, to: MotionEndedIMP.self)
      callOriginal(self, #selector(UIWindow.motionEnded(_:with:)), motion.rawValue, event)
    }
    if motion == .motionShake { T3PapercutStore.shared.handleShake() }
  }
}

private var t3OriginalMotionEnded: IMP?
