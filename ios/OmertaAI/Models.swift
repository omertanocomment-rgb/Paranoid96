import Foundation

enum EngineMode: String { case embedded, remote }

struct WireMessage: Codable { let role: String; let content: String }

struct ChatItem: Identifiable {
    let id = UUID()
    let role: String        // "user" | "assistant"
    var content: String
    var streaming: Bool = false
    var isError: Bool = false
}

enum OmertaTheme {
    static let black = 0x0A0A0B
    static let amber = 0xFFB300
}

/// Persisted settings (UserDefaults). Mirrors the Android app.
final class Settings: ObservableObject {
    @Published var mode: EngineMode {
        didSet { d.set(mode.rawValue, forKey: "mode") }
    }
    @Published var apiKey: String { didSet { d.set(apiKey, forKey: "apiKey") } }
    @Published var backendURL: String { didSet { d.set(backendURL, forKey: "backendURL") } }
    @Published var appToken: String { didSet { d.set(appToken, forKey: "appToken") } }
    @Published var model: String { didSet { d.set(model, forKey: "model") } }
    @Published var effort: String { didSet { d.set(effort, forKey: "effort") } }

    private let d = UserDefaults.standard

    init() {
        mode = EngineMode(rawValue: d.string(forKey: "mode") ?? "embedded") ?? .embedded
        apiKey = d.string(forKey: "apiKey") ?? ""
        backendURL = d.string(forKey: "backendURL") ?? "https://omerta-ai-backend.onrender.com"
        appToken = d.string(forKey: "appToken") ?? ""
        model = d.string(forKey: "model") ?? "claude-opus-5"
        effort = d.string(forKey: "effort") ?? "high"
    }

    static let models = ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5",
                         "claude-opus-4-8", "claude-fable-5-1"]
    static let efforts = ["low", "medium", "high", "xhigh", "max"]
    static let systemPrompt = """
    You are Omerta AI, an operator-grade assistant for the OMERTA toolkit. Be precise, \
    technical, and concise. Prefer copy-paste-ready commands and complete answers.
    """
}
