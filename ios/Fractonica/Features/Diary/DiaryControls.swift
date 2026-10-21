import SwiftUI
#if os(iOS)
import UIKit
#else
import AppKit
#endif

/// A row title with a quiet explanation under it.
struct DiaryRowLabel: View {
    let title: String
    let hint: String?

    init(_ title: String, hint: String? = nil) {
        self.title = title
        self.hint = hint
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
            if let hint, !hint.isEmpty {
                Text(hint)
                    .font(.caption)
                    .foregroundStyle(Theme.ink3)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

/// Numbers as the web form shows them: no grouping, no trailing zeros ("148", "0.5", "55.7558").
enum DiaryNumberFormat {
    static func plain(_ v: Double, digits: Int = 4) -> String {
        v.formatted(.number.precision(.fractionLength(0...digits)).grouping(.never).locale(Locale(identifier: "en_US_POSIX")))
    }
}

/// A measurement with its unit: typed or stepped, clamped into its range when committed.
struct DiaryNumberRow: View {
    let title: String
    @Binding var value: Double
    let range: ClosedRange<Double>
    let step: Double
    let unit: String

    init(_ title: String, value: Binding<Double>, range: ClosedRange<Double>, step: Double, unit: String) {
        self.title = title
        _value = value
        self.range = range
        self.step = step
        self.unit = unit
    }

    var body: some View {
        LabeledContent {
            HStack(spacing: 8) {
                DiaryNumberField(value: Binding(get: { value }, set: { value = $0 }), range: range, digits: step < 1 ? 1 : 0)
                Text(unit).foregroundStyle(Theme.ink3).font(.callout)
                Stepper(title, value: Binding(get: { value }, set: { value = min(range.upperBound, max(range.lowerBound, ($0 / step).rounded() * step)) }),
                        in: range, step: step)
                    .labelsHidden()
                    .fixedSize()
            }
        } label: {
            Text(title)
        }
    }
}

/// An optional coordinate: empty means "not set".
struct DiaryOptionalNumberRow: View {
    let title: String
    @Binding var value: Double?
    let range: ClosedRange<Double>
    let unit: String

    @State private var text = ""
    @FocusState private var focused: Bool

    init(_ title: String, value: Binding<Double?>, range: ClosedRange<Double>, unit: String) {
        self.title = title
        _value = value
        self.range = range
        self.unit = unit
    }

    var body: some View {
        LabeledContent {
            HStack(spacing: 8) {
                TextField(title, text: $text, prompt: Text("—"))
                    .multilineTextAlignment(.trailing)
                    .font(.reading(16))
                    .frame(maxWidth: 120)
                    .focused($focused)
                    #if os(iOS)
                    .keyboardType(.numbersAndPunctuation)
                    #endif
                    .onSubmit(commit)
                    .onChange(of: focused) { _, on in if !on { commit() } }
                Text(unit).foregroundStyle(Theme.ink3).font(.callout)
            }
        } label: {
            Text(title)
        }
        .onAppear { text = value.map { DiaryNumberFormat.plain($0) } ?? "" }
        .onChange(of: value) { _, v in if !focused { text = v.map { DiaryNumberFormat.plain($0) } ?? "" } }
    }

    private func commit() {
        let trimmed = text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
        if trimmed.isEmpty {
            value = nil
        } else if let v = Double(trimmed), v.isFinite {
            value = min(range.upperBound, max(range.lowerBound, (v * 10_000).rounded() / 10_000))
        }
        text = value.map { DiaryNumberFormat.plain($0) } ?? ""
    }
}

/// The text field of a number: commits on return or when it loses focus, never while typing.
struct DiaryNumberField: View {
    @Binding var value: Double
    let range: ClosedRange<Double>
    let digits: Int

    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        TextField("", text: $text)
            .multilineTextAlignment(.trailing)
            .font(.reading(16))
            .frame(width: 64)
            .focused($focused)
            #if os(iOS)
            .keyboardType(digits > 0 ? .decimalPad : .numberPad)
            #endif
            .onSubmit(commit)
            .onChange(of: focused) { _, on in if !on { commit() } }
            .onAppear { text = DiaryNumberFormat.plain(value, digits: digits) }
            .onChange(of: value) { _, v in if !focused { text = DiaryNumberFormat.plain(v, digits: digits) } }
    }

    private func commit() {
        if let v = Double(text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")), v.isFinite {
            value = min(range.upperBound, max(range.lowerBound, v))
        }
        text = DiaryNumberFormat.plain(value, digits: digits)
    }
}

/// A whole number stepped in its range ("12 lines per Helion").
struct DiaryCountRow: View {
    let title: String
    @Binding var value: Int
    let range: ClosedRange<Int>
    var hint: String?

    init(_ title: String, value: Binding<Int>, range: ClosedRange<Int>, hint: String? = nil) {
        self.title = title
        _value = value
        self.range = range
        self.hint = hint
    }

    var body: some View {
        Stepper(value: $value, in: range) {
            HStack(alignment: .firstTextBaseline) {
                DiaryRowLabel(title, hint: hint)
                Spacer(minLength: 8)
                Text(value, format: .number.grouping(.never))
                    .font(.reading(17, weight: .medium))
                    .foregroundStyle(Theme.ink)
                    .contentTransition(.numericText(value: Double(value)))
            }
        }
        .sensoryFeedback(.selection, trigger: value) { _, _ in AppSettings.shared.haptics }
    }
}

/// One sheet of the lock: lined Helions on its front, canvas Helions on its back.
struct DiaryLockSheetRow: View {
    let index: Int
    let sheet: [Int]
    let change: ([Int]) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Sheet \(index + 1)").font(.subheadline.weight(.semibold))
                Spacer()
                Text(kind).font(.caption).foregroundStyle(Theme.teal)
            }
            Stepper(value: Binding(get: { sheet[0] }, set: { change([$0, sheet[1]]) }), in: 1...4) {
                LabeledContent("Lined Helions on the front", value: "\(sheet[0])")
            }
            .accessibilityLabel("Sheet \(index + 1): lined Helions on the front")
            Stepper(value: Binding(get: { sheet[1] }, set: { change([sheet[0], $0]) }), in: 0...4) {
                LabeledContent("Canvas Helions on the back", value: "\(sheet[1])")
            }
            .accessibilityLabel("Sheet \(index + 1): canvas Helions on the back")
        }
        .padding(.vertical, 4)
        .font(.callout)
    }

    private var kind: String {
        switch sheet[0] + sheet[1] {
        case 5: "Pentad"
        case 4: "Semi-pentad"
        case let n: "\(n) \(n == 1 ? "Helion" : "Helions")"
        }
    }
}

/// A list of canvases: each with its type and the parameters of that type; optionally added and removed.
struct DiaryCanvasList: View {
    @Binding var list: [DiaryOptions.Canvas]
    let defaults: [DiaryOptions.Canvas]
    let name: (Int) -> String
    let editable: Bool

    var body: some View {
        ForEach(Array(list.enumerated()), id: \.offset) { i, canvas in
            VStack(alignment: .leading, spacing: 8) {
                Picker(selection: Binding(get: { canvas.kind }, set: { setType($0, at: i) })) {
                    ForEach(CanvasType.allCases) { type in
                        Label(type.label, systemImage: type.systemImage).tag(type)
                    }
                } label: {
                    Text(name(i)).font(.subheadline.weight(.semibold))
                }
                switch canvas.kind {
                case .grid, .dotGrid:
                    parameter("Columns", \.cols, at: i, range: 1...60)
                    parameter("Rows", \.rows, at: i, range: 1...60)
                case .dots:
                    parameter("Dots", \.count, at: i, range: 0...4000, step: 20)
                case .lined:
                    parameter("Lines", \.lines, at: i, range: 1...80)
                case .blank, .nuclideGrid:
                    EmptyView()
                }
            }
            .padding(.vertical, 2)
            .deleteDisabled(!editable || list.count <= 1)
        }
        .onDelete(perform: editable ? { offsets in
            var next = list
            next.remove(atOffsets: offsets)
            if !next.isEmpty { list = next }
        } : nil)
        if editable {
            Button("Add canvas", systemImage: "plus") {
                list = DiaryOptions.canvases(list + [list[list.count - 1]], defaults: defaults)
            }
            .disabled(list.count >= DiaryOptions.maxCanvases)
        }
    }

    private func setType(_ type: CanvasType, at i: Int) {
        // as the web form: the new type alone, its parameters from the defaults of that place in the list
        var next = list
        next[i] = DiaryOptions.Canvas(type)
        list = DiaryOptions.canvases(next, defaults: defaults)
    }

    private func parameter(_ title: String, _ key: WritableKeyPath<DiaryOptions.Canvas, Int?>, at i: Int,
                           range: ClosedRange<Int>, step: Int = 1) -> some View {
        Stepper(value: Binding(get: { list[i][keyPath: key] ?? range.lowerBound },
                               set: { v in
                                   var next = list
                                   next[i][keyPath: key] = v
                                   list = DiaryOptions.canvases(next, defaults: defaults)
                               }),
                in: range, step: step) {
            LabeledContent(title, value: "\(list[i][keyPath: key] ?? range.lowerBound)")
        }
        .font(.callout)
    }
}

/// The zone of the Gregorian references: the app's zone (the default), or any zone.
struct DiaryZoneList: View {
    @Binding var zone: String?
    let appZone: String

    @State private var query = ""
    @Environment(\.dismiss) private var dismiss

    private static let all = TimeZone.knownTimeZoneIdentifiers.filter { $0 != "UTC" && $0.contains("/") }.sorted()

    var body: some View {
        List {
            if query.isEmpty {
                Section {
                    row(nil, title: "App zone", detail: appZone.replacingOccurrences(of: "_", with: " "))
                    row("UTC", title: "UTC", detail: nil)
                }
            }
            Section {
                ForEach(Self.all.filter { query.isEmpty || $0.localizedCaseInsensitiveContains(query.replacingOccurrences(of: " ", with: "_")) }, id: \.self) { id in
                    row(id, title: id.replacingOccurrences(of: "_", with: " "), detail: nil)
                }
            }
        }
        .searchable(text: $query, prompt: "Search zones")
        .navigationTitle("Zone")
        .scrollContentBackground(.hidden)
        .background { Backdrop() }
    }

    private func row(_ id: String?, title: String, detail: String?) -> some View {
        Button {
            zone = id
            dismiss()
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).foregroundStyle(Theme.ink)
                    if let detail { Text(detail).font(.caption).foregroundStyle(Theme.ink3) }
                }
                Spacer()
                if zone == id { Image(systemName: "checkmark").foregroundStyle(Theme.teal) }
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }
}

/// The pasteboard, on both platforms.
@MainActor
enum DiaryClipboard {
    static func copy(_ text: String) {
        #if os(iOS)
        UIPasteboard.general.string = text
        #else
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        #endif
    }
}
