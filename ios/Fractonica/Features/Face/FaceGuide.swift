import FractonicaKit
import SwiftUI

/// "How to read" (src/ui/face/howto.js, pure.js `pureHowToLines`): what the glyphs, the dots and the colours mean on
/// both faces, and the gestures. Pure mode says it in Fractonica terms only.
struct FaceGuide: View {
    @Environment(AppSettings.self) private var settings
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let pure = settings.pure
        List {
            Section {
                HStack(spacing: 0) {
                    example(index: 2, title: "rising", value: "+2")
                    example(index: 4, title: "peak", value: "+4")
                    example(index: 6, title: "falling", value: "+2")
                }
                .padding(.vertical, 6)
                .accessibilityElement(children: .combine)
            }
            Section("Glyphs") {
                ForEach(FaceGuideText.glyphLines(pure: pure), id: \.self) { line(Text(LocalizedStringKey($0))) }
            }
            Section("The journal face") {
                ForEach(FaceGuideText.journalLines(pure: pure), id: \.self) { line(Text(LocalizedStringKey($0))) }
            }
            Section("The watch face") {
                ForEach(FaceGuideText.watchLines(pure: pure), id: \.self) { line(Text(LocalizedStringKey($0))) }
            }
            Section("Moving") {
                ForEach(FaceGuideText.gestureLines, id: \.self) { line(Text(LocalizedStringKey($0))) }
            }
        }
        .scrollContentBackground(.hidden)
        .background { Backdrop() }
        .navigationTitle("How to Read")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Done") { dismiss() }
            }
        }
    }

    private func line(_ text: Text) -> some View {
        text
            .font(.callout)
            .foregroundStyle(Theme.ink2)
            .listRowBackground(Theme.panel.opacity(0.6))
    }

    private func example(index: Int, title: String, value: String) -> some View {
        VStack(spacing: 6) {
            GlyphView(index: index, strokes: 2, color: Theme.teal)
                .frame(height: 44)
            Text(verbatim: title).font(.caption.weight(.semibold)).foregroundStyle(Theme.ink)
            Text(verbatim: value).font(.caption.monospacedDigit()).foregroundStyle(Theme.ink3)
        }
        .frame(maxWidth: .infinity)
    }
}
