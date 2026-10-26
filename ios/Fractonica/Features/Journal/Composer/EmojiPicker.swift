import SwiftUI

/// The emoji header's picker: recent choices, then every emoji (`EmojiCatalog`) in Unicode's groups (Smileys & Emotion
/// … Flags), and a search by name ("moon", "coffee", "red heart", "flag japan"). Tap one to choose it; the current one
/// can be removed.
struct EmojiPicker: View {
    @Binding var selection: String?
    let done: () -> Void

    @State private var prefs = JournalPreferences.shared
    @State private var query = ""
    @State private var category = EmojiCatalog.categories[0].id

    private let columns = [GridItem(.adaptive(minimum: 46, maximum: 56), spacing: 4)]

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVGrid(columns: columns, alignment: .leading, spacing: 4, pinnedViews: [.sectionHeaders]) {
                        if !query.isEmpty {
                            let found = EmojiCatalog.search(query)
                            Section {
                                ForEach(found, id: \.self) { cell($0) }
                            } header: {
                                header(found.isEmpty ? "No emoji named “\(query)”" : "Results")
                            }
                        } else {
                            if !prefs.recentEmoji.isEmpty {
                                Section {
                                    ForEach(prefs.recentEmoji, id: \.self) { cell($0) }
                                } header: {
                                    header("Recent")
                                }
                            }
                            ForEach(EmojiCatalog.categories) { group in
                                Section {
                                    ForEach(group.emoji, id: \.self) { cell($0) }
                                } header: {
                                    header(group.title)
                                }
                                .id(group.id)
                            }
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.bottom, 16)
                }
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    if query.isEmpty { categoryBar(proxy) }
                }
            }
            .background { Backdrop() }
            .searchable(text: $query, placement: searchPlacement, prompt: Text("Search emoji"))
            .autocorrectionDisabled()
            .navigationTitle("Emoji")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                if selection != nil {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Remove", role: .destructive) {
                            selection = nil
                            done()
                        }
                    }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button("Any Emoji", systemImage: "die.face.5") {
                        selection = EmojiCatalog.random()
                        Haptics.play(.selection)
                    }
                    .help("Choose one at random")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", systemImage: "checkmark", role: .confirmIfAvailable, action: done)
                }
            }
        }
    }

    private var searchPlacement: SearchFieldPlacement {
        #if os(iOS)
        .navigationBarDrawer(displayMode: .always)
        #else
        .automatic
        #endif
    }

    private func cell(_ emoji: String) -> some View {
        Button {
            selection = emoji
            prefs.noteEmoji(emoji)
            Haptics.play(.selection)
            done()
        } label: {
            Text(verbatim: emoji)
                .font(.system(size: 32))
                .frame(width: 48, height: 48)
                .background(selection == emoji ? Theme.teal.opacity(0.22) : .clear, in: .rect(cornerRadius: 12, style: .continuous))
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(EmojiCatalog.name(emoji))
    }

    private func header(_ title: String) -> some View {
        Text(title)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(Theme.ink3)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 6)
            .padding(.horizontal, 4)
            .background(Theme.background.opacity(0.92))
    }

    private func categoryBar(_ proxy: ScrollViewProxy) -> some View {
        HStack(spacing: 0) {
            ForEach(EmojiCatalog.categories) { group in
                Button {
                    category = group.id
                    withAnimation(.snappy) { proxy.scrollTo(group.id, anchor: .top) }
                } label: {
                    Text(verbatim: group.icon)
                        .font(.system(size: 20))
                        .frame(maxWidth: .infinity, minHeight: 40)
                        .opacity(category == group.id ? 1 : 0.55)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(group.title)
            }
        }
        .padding(.horizontal, 8)
        .glassSurface(.regular.interactive(), in: .capsule)
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
    }
}
