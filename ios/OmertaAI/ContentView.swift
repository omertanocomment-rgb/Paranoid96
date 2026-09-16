import SwiftUI

private extension Color {
    static let omBlack = Color(red: 0.04, green: 0.04, blue: 0.043)
    static let omSurface = Color(red: 0.078, green: 0.078, blue: 0.086)
    static let omAmber = Color(red: 1.0, green: 0.70, blue: 0.0)
    static let omBorder = Color(red: 0.165, green: 0.165, blue: 0.18)
    static let omText = Color(red: 0.925, green: 0.925, blue: 0.925)
    static let omUser = Color(red: 0.122, green: 0.165, blue: 0.102)
}

struct ContentView: View {
    @StateObject private var settings = Settings()
    @State private var items: [ChatItem] = []
    @State private var input = ""
    @State private var sending = false
    @State private var showSettings = false

    private var needsKey: Bool { settings.mode == .embedded && settings.apiKey.isEmpty }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if items.isEmpty { emptyState } else { messageList }
                inputBar
            }
            .background(Color.omBlack.ignoresSafeArea())
            .navigationTitle("OMERTA AI")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button { items.removeAll() } label: { Image(systemName: "trash") }
                        .tint(.omText)
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button { showSettings = true } label: { Image(systemName: "gearshape") }
                        .tint(.omText)
                }
            }
            .sheet(isPresented: $showSettings) { SettingsView(settings: settings) }
        }
        .font(.system(.body, design: .monospaced))
        .tint(.omAmber)
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Spacer()
            Text("OMERTA AI").font(.system(.largeTitle, design: .monospaced)).bold().foregroundColor(.omAmber)
            Text("operator-grade assistant · Claude built in")
                .font(.system(.caption, design: .monospaced)).foregroundColor(.gray)
            if needsKey {
                Button { showSettings = true } label: {
                    Text("› Add your Anthropic API key to start")
                        .font(.system(.callout, design: .monospaced)).foregroundColor(.omAmber)
                        .padding().frame(maxWidth: .infinity)
                        .background(Color.omSurface).overlay(
                            RoundedRectangle(cornerRadius: 8).stroke(Color.omAmber))
                        .cornerRadius(8)
                }.padding(.horizontal)
            }
            Spacer()
        }.padding()
    }

    private var messageList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    ForEach(items) { item in bubble(item).id(item.id) }
                }.padding(.vertical, 8)
            }
            .onChange(of: items.last?.content) { _ in
                if let last = items.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
            }
        }
    }

    private func bubble(_ item: ChatItem) -> some View {
        let isUser = item.role == "user"
        return VStack(alignment: isUser ? .trailing : .leading, spacing: 3) {
            Text(item.isError ? "ERROR" : (isUser ? "OPERATOR" : "OMERTA"))
                .font(.system(size: 10, design: .monospaced))
                .foregroundColor(item.isError ? .red : (isUser ? .gray : .omAmber))
            Text(item.content.isEmpty && item.streaming ? "…" : item.content)
                .font(.system(.body, design: .monospaced))
                .foregroundColor(item.isError ? .red : .omText)
                .padding(10)
                .background(isUser ? Color.omUser : Color.omSurface)
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.omBorder))
                .cornerRadius(10)
        }
        .frame(maxWidth: .infinity, alignment: isUser ? .trailing : .leading)
        .padding(.horizontal, 12)
    }

    private var inputBar: some View {
        HStack(spacing: 8) {
            TextField("message omerta…", text: $input, axis: .vertical)
                .textFieldStyle(.plain).padding(10).lineLimit(1...5)
                .background(Color.omSurface)
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.omBorder))
                .cornerRadius(8).foregroundColor(.omText)
            Button(action: send) {
                Image(systemName: "paperplane.fill")
                    .padding(12).background(sendEnabled ? Color.omAmber : Color.omBorder)
                    .foregroundColor(.omBlack).clipShape(Circle())
            }.disabled(!sendEnabled)
        }.padding(10).background(Color.omBlack)
    }

    private var sendEnabled: Bool { !sending && !input.trimmingCharacters(in: .whitespaces).isEmpty }

    private func send() {
        let text = input.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }
        items.append(ChatItem(role: "user", content: text))
        input = ""; sending = true
        var placeholder = ChatItem(role: "assistant", content: "", streaming: true)
        items.append(placeholder)
        let idx = items.count - 1
        let history = items.filter { !$0.streaming && !$0.isError }.map { WireMessage(role: $0.role, content: $0.content) }

        Task {
            let client = OmertaClient(settings)
            var acc = ""
            do {
                try await client.stream(history: history) { delta in
                    acc += delta
                    Task { @MainActor in if idx < items.count { items[idx].content = acc } }
                }
                await MainActor.run { if idx < items.count { items[idx].content = acc; items[idx].streaming = false } }
            } catch {
                let msg = (error as? OmertaClient.StreamError)?.message ?? error.localizedDescription
                await MainActor.run {
                    if idx < items.count { items.remove(at: idx) }
                    items.append(ChatItem(role: "assistant", content: msg, isError: true))
                }
            }
            await MainActor.run { sending = false }
        }
    }
}

struct SettingsView: View {
    @ObservedObject var settings: Settings
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Engine") {
                    Picker("Mode", selection: $settings.mode) {
                        Text("Embedded (in-app)").tag(EngineMode.embedded)
                        Text("Remote (engine)").tag(EngineMode.remote)
                    }.pickerStyle(.segmented)
                    if settings.mode == .embedded {
                        SecureField("Anthropic API key", text: $settings.apiKey)
                        Text("Calls Claude directly. Key stored on device.")
                            .font(.caption).foregroundColor(.gray)
                    } else {
                        TextField("Backend URL", text: $settings.backendURL).autocorrectionDisabled()
                        SecureField("App token (x-omerta-key)", text: $settings.appToken)
                    }
                }
                Section("Model") {
                    Picker("Model", selection: $settings.model) {
                        ForEach(Settings.models, id: \.self) { Text($0).tag($0) }
                    }
                    Picker("Effort", selection: $settings.effort) {
                        ForEach(Settings.efforts, id: \.self) { Text($0).tag($0) }
                    }.pickerStyle(.segmented)
                }
            }
            .navigationTitle("Settings")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .preferredColorScheme(.dark)
        .font(.system(.body, design: .monospaced))
    }
}
