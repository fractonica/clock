import FractonicaKit
import SwiftUI

/// The time zone Earth times are shown in: System first, then UTC, then every zone the device knows, searchable by
/// city, region or offset.
struct TimeZonePicker: View {
    @Environment(AppSettings.self) private var settings
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private static let zones: [TimeZoneName] = TimeZone.knownTimeZoneIdentifiers
        .filter { $0 != "UTC" && $0 != "GMT" }
        .map(TimeZoneName.init(identifier:))
        .sorted { ($0.city, $0.region) < ($1.city, $1.region) }

    var body: some View {
        List {
            if query.isEmpty {
                Section {
                    row(zone: nil, title: "System", detail: TimeZoneName(identifier: TimeZone.current.identifier).full)
                    row(zone: "UTC", title: "UTC", detail: "Coordinated Universal Time")
                }
            }
            Section {
                ForEach(matches, id: \.identifier) { name in
                    row(zone: name.identifier, title: name.city, detail: name.region)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background { Backdrop() }
        .searchable(text: $query, prompt: "City, region or offset")
        .navigationTitle("Time zone")
    }

    private var matches: [TimeZoneName] {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return Self.zones }
        return Self.zones.filter { $0.full.localizedStandardContains(q) || offset($0.identifier).localizedStandardContains(q) }
    }

    private func row(zone: String?, title: String, detail: String) -> some View {
        let selected = settings.zone == zone
        return Button {
            settings.zone = zone
            Haptics.play(.selection)
            dismiss()
        } label: {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).foregroundStyle(Theme.ink)
                    Text(detail).font(.caption).foregroundStyle(Theme.ink3)
                }
                Spacer()
                Text(offset(zone ?? TimeZone.current.identifier))
                    .font(.reading(13))
                    .foregroundStyle(Theme.ink2)
                Image(systemName: "checkmark")
                    .foregroundStyle(Theme.teal)
                    .opacity(selected ? 1 : 0)
                    .accessibilityHidden(!selected)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    /// "UTC+03:00" now.
    private func offset(_ identifier: String) -> String {
        guard let zone = TimeZone(identifier: identifier) else { return "" }
        return EarthFormatter(timeZone: zone).tag(Date.now.timeIntervalSince1970)
    }
}

/// An IANA identifier read as words: "America/Argentina/Buenos_Aires" is the city "Buenos Aires" in the region
/// "America · Argentina".
struct TimeZoneName: Sendable {
    let identifier: String
    let city: String
    let region: String

    init(identifier: String) {
        self.identifier = identifier
        let parts = identifier.split(separator: "/").map { $0.replacingOccurrences(of: "_", with: " ") }
        city = parts.last ?? identifier
        region = parts.dropLast().joined(separator: " · ")
    }

    /// "Buenos Aires, America · Argentina".
    var full: String { region.isEmpty ? city : "\(city), \(region)" }
}
