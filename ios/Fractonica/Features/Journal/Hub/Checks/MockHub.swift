import Foundation

/// Checks/mockhub.mjs run with Node on a free port, for the engine checks. It exits when the checks do (its stdin
/// closes). `restart()` keeps its data (a state file), as a hub restart does.
@MainActor
final class MockHub {
    let script: URL
    let stateFile: URL
    private var process: Process?
    private var input: Pipe?
    private(set) var port = 0
    private var codes: [String]
    static let admin = "fxh_admin_checks"

    init?(codes: [String]) {
        script = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("mockhub.mjs")
        stateFile = FileManager.default.temporaryDirectory.appendingPathComponent("mockhub-\(UUID().uuidString).json")
        self.codes = codes
        guard FileManager.default.fileExists(atPath: script.path), Self.node != nil else { return nil }
    }

    static var node: String? {
        let candidates = ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"]
        if let found = candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) { return found }
        let which = Process()
        which.executableURL = URL(fileURLWithPath: "/usr/bin/which")
        which.arguments = ["node"]
        let out = Pipe()
        which.standardOutput = out
        try? which.run()
        which.waitUntilExit()
        let path = String(decoding: out.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return path.isEmpty ? nil : path
    }

    var url: URL { URL(string: "http://127.0.0.1:\(port)")! }

    /// Starts the hub (on the same port as before, after a restart). Returns false when it did not come up.
    func start(port wanted: Int = 0) -> Bool {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: Self.node!)
        var arguments = [script.path, "--port", String(wanted), "--host", "127.0.0.1", "--admin", Self.admin,
                         "--state", stateFile.path, "--quiet", "--exit-on-stdin-close", "--name", "Checks Hub"]
        for code in codes { arguments += ["--code", code] }
        codes = []
        process.arguments = arguments
        let output = Pipe()
        let input = Pipe()
        process.standardOutput = output
        process.standardInput = input
        do { try process.run() } catch { return false }
        self.process = process
        self.input = input
        var text = ""
        while !text.contains("\n") {
            let chunk = output.fileHandleForReading.availableData
            if chunk.isEmpty { break }
            text += String(decoding: chunk, as: UTF8.self)
        }
        guard let range = text.range(of: "LISTENING "),
              let port = Int(text[range.upperBound...].prefix { $0.isNumber }) else { return false }
        self.port = port
        return true
    }

    func stop() {
        guard let process else { return }
        process.terminate()
        process.waitUntilExit()
        self.process = nil
    }

    func restart() -> Bool {
        let port = self.port
        stop()
        return start(port: port)
    }

    func cleanUp() {
        stop()
        try? FileManager.default.removeItem(at: stateFile)
    }

    // MARK: Controls

    var adminClient: HubClient { HubClient(base: url, token: Self.admin) }

    @discardableResult
    func control(_ path: String, _ body: [String: Any] = [:], method: String = "POST") async -> [String: Any] {
        var request = URLRequest(url: url.appendingPathComponent(path))
        request.httpMethod = method
        request.setValue("Bearer \(Self.admin)", forHTTPHeaderField: "Authorization")
        if method != "GET" {
            request.httpBody = try? JSONSerialization.data(withJSONObject: body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        guard let (data, _) = try? await URLSession.shared.data(for: request),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return object
    }

    func state() async -> [String: Any] { await control("_mock/state", method: "GET") }

    /// A fresh pairing code.
    func code() async -> String { await control("_mock/code")["code"] as? String ?? "" }
}
