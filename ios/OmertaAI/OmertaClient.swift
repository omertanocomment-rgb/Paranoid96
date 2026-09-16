import Foundation

/// Streams assistant text. EMBEDDED calls the Anthropic API directly; REMOTE calls
/// the OMERTA engine / Node backend (same SSE protocol as the Android app).
final class OmertaClient {
    let settings: Settings
    init(_ settings: Settings) { self.settings = settings }

    struct StreamError: Error { let message: String }

    func stream(history: [WireMessage], onDelta: @escaping (String) -> Void) async throws {
        switch settings.mode {
        case .embedded: try await streamAnthropic(history: history, onDelta: onDelta)
        case .remote:   try await streamRemote(history: history, onDelta: onDelta)
        }
    }

    // MARK: Embedded — Anthropic Messages API (direct)
    private func streamAnthropic(history: [WireMessage], onDelta: @escaping (String) -> Void) async throws {
        let key = settings.apiKey.trimmingCharacters(in: .whitespaces)
        guard !key.isEmpty else { throw StreamError(message: "No Anthropic API key set — add it in Settings") }
        var req = URLRequest(url: URL(string: "https://api.anthropic.com/v1/messages")!)
        req.httpMethod = "POST"
        req.setValue(key, forHTTPHeaderField: "x-api-key")
        req.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.setValue("text/event-stream", forHTTPHeaderField: "accept")

        let thinking: [String: Any] = settings.model.hasPrefix("claude-haiku")
            ? ["type": "enabled", "budget_tokens": 2048]
            : ["type": "adaptive", "display": "summarized"]
        let body: [String: Any] = [
            "model": settings.model,
            "max_tokens": 32000,
            "stream": true,
            "thinking": thinking,
            "output_config": ["effort": settings.effort],
            "system": Settings.systemPrompt,
            "messages": history.map { ["role": $0.role, "content": $0.content] },
        ]
        req.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (bytes, resp) = try await URLSession.shared.bytes(for: req)
        try checkResponse(resp)
        for try await line in bytes.lines {
            guard line.hasPrefix("data:") else { continue }
            let data = String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces)
            if data.isEmpty { continue }
            guard let obj = json(data) else { continue }
            if (obj["type"] as? String) == "content_block_delta",
               let delta = obj["delta"] as? [String: Any],
               (delta["type"] as? String) == "text_delta",
               let text = delta["text"] as? String {
                onDelta(text)
            } else if (obj["type"] as? String) == "message_stop" {
                return
            } else if (obj["type"] as? String) == "error",
                      let e = obj["error"] as? [String: Any],
                      let m = e["message"] as? String {
                throw StreamError(message: m)
            }
        }
    }

    // MARK: Remote — OMERTA engine / Node backend SSE
    private func streamRemote(history: [WireMessage], onDelta: @escaping (String) -> Void) async throws {
        let base = settings.backendURL.trimmingCharacters(in: CharacterSet(charactersIn: "/ "))
        guard let url = URL(string: base + "/api/chat/stream") else { throw StreamError(message: "Bad backend URL") }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.setValue("text/event-stream", forHTTPHeaderField: "accept")
        if !settings.appToken.isEmpty { req.setValue(settings.appToken, forHTTPHeaderField: "x-omerta-key") }
        let body: [String: Any] = [
            "messages": history.map { ["role": $0.role, "content": $0.content] },
            "model": settings.model, "effort": settings.effort, "stream": true,
        ]
        req.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (bytes, resp) = try await URLSession.shared.bytes(for: req)
        try checkResponse(resp)
        var event = "message"
        for try await line in bytes.lines {
            if line.hasPrefix("event:") { event = String(line.dropFirst(6)).trimmingCharacters(in: .whitespaces) }
            else if line.hasPrefix("data:") {
                let data = String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces)
                if data.isEmpty { continue }
                guard let obj = json(data) else { continue }
                if event == "delta", let t = obj["text"] as? String { onDelta(t) }
                else if event == "done" { return }
                else if event == "error" { throw StreamError(message: obj["message"] as? String ?? "stream error") }
            }
        }
    }

    private func checkResponse(_ resp: URLResponse) throws {
        if let http = resp as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            throw StreamError(message: "HTTP \(http.statusCode)")
        }
    }

    private func json(_ s: String) -> [String: Any]? {
        guard let d = s.data(using: .utf8) else { return nil }
        return (try? JSONSerialization.jsonObject(with: d)) as? [String: Any]
    }
}
