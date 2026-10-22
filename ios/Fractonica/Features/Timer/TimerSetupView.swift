import FractonicaKit
import SwiftUI

/// Setting a timer: wheels of unit counts (Earth mode may switch them to hours, minutes and seconds), Start, quick
/// presets that start at a tap, timers that end where the clock's next cycle begins, and recent timers.
struct TimerSetupView: View {
    @Environment(AppSettings.self) private var settings
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .title) private var wheelRow: CGFloat = 40

    private var store: TimerStore { .shared }

    var body: some View {
        GeometryReader { geo in
            let wide = geo.size.width >= 760
            ScrollView {
                if wide {
                    let large = geo.size.width >= 1000
                    let column: CGFloat = large ? 540 : 460
                    HStack(alignment: .center, spacing: large ? 56 : 40) {
                        VStack(spacing: 24) {
                            notices
                            setter(rowHeight: rowHeight(max(wheelRow, large ? 58 : 48), width: column), controls: large ? 92 : 82)
                        }
                        .frame(maxWidth: column)
                        VStack(spacing: 28) {
                            presets
                            aligned
                            recents
                        }
                        .frame(maxWidth: large ? 540 : 480)
                    }
                    .padding(.horizontal, 32)
                    .padding(.vertical, 28)
                    .frame(maxWidth: .infinity, minHeight: geo.size.height * 0.9)
                } else {
                    VStack(spacing: 28) {
                        notices
                        setter(rowHeight: rowHeight(wheelRow, width: min(geo.size.width, 640) - 32), controls: 78)
                        presets
                        aligned
                        recents
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 12)
                    .padding(.bottom, 32)
                    .frame(maxWidth: 640)
                    .frame(maxWidth: .infinity)
                }
            }
            .scrollIndicators(.hidden)
        }
    }

    /// The wheels' row height: as asked (it grows with Dynamic Type), but never wider than the column. Four wheels take
    /// 8.34 rows and 32 pt of width (each 1.45 rows, its letter half a row and 4 pt; the gaps; the band's inset).
    private func rowHeight(_ wanted: CGFloat, width: CGFloat) -> CGFloat {
        max(28, min(wanted, (width - 32) / 8.4))
    }

    // MARK: The wheels

    private func setter(rowHeight: CGFloat, controls: CGFloat) -> some View {
        @Bindable var store = store
        let pure = settings.pure
        let earth = !pure && store.draft.input == .earth
        let spec = store.draft.spec(pure: pure)
        let empty = earth ? store.draft.earthSeconds == 0 : store.draft.ladder.isZero
        let unmeasurable = spec.measure == .ladder && !store.clock.inRange(.now)
        var tooLong = false
        if case .ladder(let span) = spec, !span.isZero, !unmeasurable { tooLong = !fits(span) }
        return VStack(spacing: 18) {
            if !pure {
                Picker("Units", selection: $store.draft.input) {
                    Text("Fractonica").tag(TimerStore.Draft.Input.ladder)
                    Text("Earth").tag(TimerStore.Draft.Input.earth)
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 260)
                .accessibilityLabel("Set the duration in")
            }
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(Theme.panel2.opacity(0.9))
                    .frame(height: rowHeight)
                    .overlay {
                        RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.line, lineWidth: 1)
                    }
                HStack(spacing: rowHeight * 0.18) {
                    if earth {
                        earthWheels(rowHeight: rowHeight)
                    } else {
                        ladderWheels(rowHeight: rowHeight)
                    }
                }
                .padding(.horizontal, 8)
            }
            .frame(height: rowHeight * 5)
            .id(earth)
            equivalence(spec: spec, tooLong: tooLong)
            HStack {
                RoundControl("Reset", size: RoundControl.size(controls, dynamicType: dynamicTypeSize)) {
                    withAnimation(.snappy) {
                        if earth { store.draft.earthSeconds = 0 } else { store.draft.ladder = LadderSpan() }
                    }
                }
                .disabled(empty)
                Spacer()
                RoundControl("Start", tint: Theme.teal, size: RoundControl.size(controls, dynamicType: dynamicTypeSize)) {
                    withAnimation(.smooth) { _ = store.start(spec) }
                }
                .disabled(empty || unmeasurable || tooLong)
                .keyboardShortcut(.defaultAction)
            }
            .padding(.horizontal, 12)
        }
    }

    private func ladderWheels(rowHeight: CGFloat) -> some View {
        ForEach(LadderUnit.allCases) { unit in
            UnitWheel(
                value: Binding(
                    get: { store.draft.ladder.count(unit) },
                    set: { n in
                        var counts = LadderUnit.allCases.map { store.draft.ladder.count($0) }
                        counts[LadderUnit.allCases.firstIndex(of: unit)!] = n
                        store.draft.ladder = LadderSpan(eta: counts[0], iota: counts[1], lambda: counts[2], nu: counts[3])
                    }
                ),
                range: 0...unit.wheelMax,
                symbol: unit.symbol,
                color: Theme.levelColor(unit.level),
                label: unit.name + "s",
                rowHeight: rowHeight,
                height: rowHeight * 5
            )
        }
    }

    private func earthWheels(rowHeight: CGFloat) -> some View {
        let parts: [(symbol: String, label: String, size: Int, range: ClosedRange<Int>)] = [
            ("h", "Hours", 3600, 0...23), ("min", "Minutes", 60, 0...59), ("s", "Seconds", 1, 0...59),
        ]
        return ForEach(parts, id: \.symbol) { part in
            UnitWheel(
                value: Binding(
                    get: { (store.draft.earthSeconds / part.size) % (part.size == 3600 ? 24 : 60) },
                    set: { n in
                        let s = store.draft.earthSeconds
                        let old = (s / part.size) % (part.size == 3600 ? 24 : 60)
                        store.draft.earthSeconds = s + (n - old) * part.size
                    }
                ),
                range: part.range,
                symbol: part.symbol,
                color: Theme.ink2,
                label: part.label,
                rowHeight: rowHeight,
                height: rowHeight * 5
            )
        }
    }

    /// What the wheels say in other words: "4 Preons · ≈ 33 min 41 s", or an Earth span on the ladder "≈ 3ι 57λ".
    private func equivalence(spec: TimerSpec, tooLong: Bool) -> some View {
        let clock = store.clock
        let blink = clock.blinkSeconds(at: .now)
        let text: String
        switch spec {
        case .ladder where tooLong:
            text = "It would end outside the catalogue"
        case .ladder(let span):
            if span.isZero {
                text = "Turn the wheels to set a duration"
            } else if settings.pure || blink == nil {
                text = span.spoken
            } else {
                text = "\(span.spoken)  ·  ≈ \(EarthTime.duration(Double(span.blinks) * blink!, parts: 2))"
            }
        case .earth(let seconds):
            if seconds == 0 {
                text = "Turn the wheels to set a duration"
            } else if let blink {
                text = "≈ \(LadderSpan(blinks: LadderReadout.ceilBlinks(Double(seconds) / blink)).name(parts: 3)) on the ladder"
            } else {
                text = EarthClockText.name(seconds: seconds)
            }
        case .aligned:
            text = ""
        }
        return Text(text)
            .font(.footnote.monospacedDigit())
            .foregroundStyle(Theme.ink3)
            .multilineTextAlignment(.center)
            .contentTransition(.numericText())
            .animation(.snappy, value: text)
    }

    // MARK: Notices

    @ViewBuilder
    private var notices: some View {
        if !store.clock.inRange(.now) {
            notice(
                systemImage: "circle.dashed",
                text: settings.pure
                    ? "Real now lies outside the catalogue (\(Notation.standard.catalogueText())). The ladder cannot be measured here."
                    : "The device clock reads outside the catalogue (\(catalogueYears)), so Fractonica timers cannot be measured. Earth timers still run."
            )
        } else if store.problem == .outsideCatalogue {
            notice(systemImage: "exclamationmark.circle", text: "That timer would end outside the catalogue.")
        }
        if store.access == .denied {
            NotificationsOffNotice()
        }
    }

    /// "1613–2857": the catalogue's first and last years.
    private var catalogueYears: String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .gmt
        let clock = store.clock.clock
        func year(_ t: Double) -> Int { calendar.component(.year, from: Date(timeIntervalSince1970: t)) }
        return "\(year(clock.tMin))–\(year(clock.tMax))"
    }

    private func notice(systemImage: String, text: String) -> some View {
        Label(text, systemImage: systemImage)
            .font(.footnote)
            .foregroundStyle(Theme.ink2)
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .timerCard()
    }

    // MARK: Presets

    private var presets: some View {
        VStack(spacing: 10) {
            TimerSectionHeader(title: "Presets")
            LazyVGrid(columns: [GridItem(.adaptive(minimum: dynamicTypeSize.isAccessibilitySize ? 160 : 96), spacing: 10)], spacing: 10) {
                ForEach(TimerPresets.spans, id: \.self) { span in
                    Button {
                        withAnimation(.smooth) { _ = store.start(.ladder(span)) }
                    } label: {
                        VStack(spacing: 4) {
                            Text(span.name)
                                .font(.reading(21, weight: .semibold))
                                .foregroundStyle(Theme.levelColor(span.lead.level))
                            Text(presetSubtitle(span))
                                .font(.caption)
                                .foregroundStyle(Theme.ink3)
                                .lineLimit(1)
                                .minimumScaleFactor(0.8)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .timerCard()
                        .contentShape(.rect(cornerRadius: 16))
                    }
                    .buttonStyle(CardButtonStyle())
                    .disabled(!fits(span))
                    .opacity(fits(span) ? 1 : 0.4)
                    .accessibilityLabel("Start \(span.spoken)")
                    .accessibilityHint(presetSubtitle(span))
                }
            }
        }
    }

    /// Whether a span started now ends inside the catalogue (near its end the long presets do not).
    private func fits(_ span: LadderSpan) -> Bool {
        store.clock.date(after: .now, blinks: Double(span.blinks)) != nil
    }

    private func presetSubtitle(_ span: LadderSpan) -> String {
        guard !settings.pure, let blink = store.clock.blinkSeconds(at: .now) else { return TimerPresets.meaning(span) }
        return "≈ " + EarthTime.duration(Double(span.blinks) * blink, parts: 2)
    }

    // MARK: Until the next cycle

    @ViewBuilder
    private var aligned: some View {
        let clock = store.clock
        let now = Date.now
        if clock.inRange(now), let blink = clock.blinkSeconds(at: now),
           let nu = clock.clock.level(at: clock.t(now), LadderUnit.nu.level) {
            VStack(spacing: 10) {
                TimerSectionHeader(title: "Until the next")
                TimelineView(TickSchedule(anchor: clock.date(nu.end), steps: [blink])) { context in
                    let t = clock.t(context.date)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: dynamicTypeSize.isAccessibilitySize ? 300 : 150), spacing: 10)], spacing: 10) {
                        ForEach(AlignedTarget.levels, id: \.self) { level in
                            if let target = AlignedTarget.next(level: level, after: t) {
                                alignedCard(target, now: context.date, blink: blink)
                            }
                        }
                    }
                }
            }
        }
    }

    private func alignedCard(_ target: AlignedTarget, now: Date, blink: Double) -> some View {
        let clock = store.clock
        let left = clock.blinks(from: now, to: clock.date(target.time)).map(LadderReadout.ceilBlinks) ?? 0
        let name = target.name(settings.wording.notation)
        let color = Theme.levelColor(target.level)
        return Button {
            withAnimation(.smooth) {
                if let fresh = AlignedTarget.next(level: target.level, after: clock.t(.now)) { _ = store.start(.aligned(fresh)) }
            }
        } label: {
            HStack(spacing: 12) {
                Text(Fractonica.periodName(target.level).text)
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(color)
                    .frame(width: 38, height: 38)
                    .background(color.opacity(0.14), in: .circle)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Next \(AlignedTarget.word(level: target.level))")
                        .font(.caption)
                        .foregroundStyle(Theme.ink3)
                    Text(name)
                        .font(.reading(17, weight: .semibold))
                        .foregroundStyle(Theme.ink)
                    Text("in \(LadderSpan(blinks: left).name(parts: 2))")
                        .font(.reading(13))
                        .foregroundStyle(Theme.ink2)
                }
                Spacer(minLength: 0)
            }
            .padding(12)
            .timerCard()
            .contentShape(.rect(cornerRadius: 16))
        }
        .buttonStyle(CardButtonStyle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Until the next \(AlignedTarget.word(level: target.level)), \(name), in \(LadderSpan(blinks: left).spoken)")
        .accessibilityAddTraits(.isButton)
    }

    // MARK: Recents

    @ViewBuilder
    private var recents: some View {
        let items = store.recents.filter { settings.pure ? $0.measure == .ladder : true }
        if !items.isEmpty {
            VStack(spacing: 10) {
                TimerSectionHeader(title: "Recent")
                VStack(spacing: 0) {
                    ForEach(Array(items.enumerated()), id: \.element) { i, spec in
                        if i > 0 { Divider().overlay(Theme.line).padding(.leading, 16) }
                        recentRow(spec)
                    }
                }
                .timerCard()
            }
        }
    }

    private func recentRow(_ spec: TimerSpec) -> some View {
        let words = store.words
        let subtitle: String = {
            switch spec {
            case .ladder(let span):
                guard !settings.pure, let blink = store.clock.blinkSeconds(at: .now) else { return span.spoken }
                return "≈ " + EarthTime.duration(Double(span.blinks) * blink, parts: 2)
            case .earth(let seconds):
                guard let blink = store.clock.blinkSeconds(at: .now) else { return "Earth" }
                return "≈ " + LadderSpan(blinks: LadderReadout.ceilBlinks(Double(seconds) / blink)).name(parts: 2)
            case .aligned:
                return ""
            }
        }()
        return HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(words.title(spec))
                    .font(.reading(22, weight: .light))
                    .foregroundStyle(Theme.ink)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(Theme.ink3)
            }
            Spacer()
            Button {
                withAnimation(.smooth) { _ = store.start(spec) }
            } label: {
                Image(systemName: "play.fill")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.teal)
                    .frame(width: 40, height: 40)
            }
            .buttonStyle(.plain)
            .glassSurface(.regular.tint(Theme.teal.opacity(0.18)).interactive(), in: .circle)
            .accessibilityLabel("Start \(words.spokenTitle(spec))")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .contextMenu {
            Button("Start", systemImage: "play") { _ = store.start(spec) }
            Button("Remove", systemImage: "trash", role: .destructive) { withAnimation { store.forget(spec) } }
        }
    }
}

/// Notifications are off: the timer then rings only while the app is open.
struct NotificationsOffNotice: View {
    @Environment(\.openURL) private var openURL

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: "bell.slash")
                .foregroundStyle(Theme.ink3)
            Text("Notifications are off, so a timer rings only while Fractonica is open.")
                .font(.footnote)
                .foregroundStyle(Theme.ink2)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button("Settings") {
                if let url = settingsURL { openURL(url) }
            }
            .font(.footnote.weight(.semibold))
            .buttonStyle(.borderless)
        }
        .padding(14)
        .timerCard()
    }

    private var settingsURL: URL? {
        #if os(iOS)
        URL(string: UIApplication.openNotificationSettingsURLString)
        #else
        URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension")
        #endif
    }
}
