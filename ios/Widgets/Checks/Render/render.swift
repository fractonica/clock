import AppKit
import FractonicaKit
import ImageIO
import SwiftUI
import UniformTypeIdentifiers
import WidgetKit

// Contact sheets of every widget family at its exact size (render.sh). Not part of any target.
//
//   render OUT_DIR [unix time [zone]]

/// Point sizes of the families: iPhone 15 Pro (393 pt wide) and Pro Max (430 pt), iPad Pro 13″ extra large; the
/// Lock Screen's accessories at the Pro's sizes.
enum Size {
    static let small = [CGSize(width: 158, height: 158), CGSize(width: 170, height: 170)]
    static let medium = [CGSize(width: 338, height: 158), CGSize(width: 364, height: 170)]
    static let large = [CGSize(width: 338, height: 354), CGSize(width: 364, height: 382)]
    static let circular = CGSize(width: 72, height: 72)
    static let rectangular = CGSize(width: 160, height: 72)
    static let inline = CGSize(width: 234, height: 26)
}

/// A widget on a Home Screen: the container background (the backdrop), rounded corners, 16 pt content margins.
struct HomeCell<Content: View>: View {
    var title: String
    var size: CGSize
    var background = true
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.system(size: 11, weight: .medium)).foregroundStyle(.white.opacity(0.55))
            ZStack {
                if background { Backdrop() } else { Color.black }
                content.padding(16)
            }
            .frame(width: size.width, height: size.height)
            .clipShape(RoundedRectangle(cornerRadius: size.height < 200 ? 22 : 24, style: .continuous))
        }
    }
}

/// An accessory on the Lock Screen: no container, drawn in white over the wallpaper (the vibrant look approximated
/// by rendering in grey levels).
struct LockCell<Content: View>: View {
    var title: String
    var size: CGSize
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.system(size: 11, weight: .medium)).foregroundStyle(.white.opacity(0.55))
            content
                .frame(width: size.width, height: size.height)
                .environment(\.widgetRenderingMode, .vibrant)
                .grayscale(1)
                .brightness(0.25)
        }
    }
}

/// A widget on a tinted or clear Home Screen (iOS 18 on): the accented rendering mode. The system drops the container
/// background and paints every view in one tint, keeping only its opacity; white masked by the content stands in for
/// that, so ranks drawn with colour alone show up flattened here, as on the device.
struct TintCell<Content: View>: View {
    var title: String
    var size: CGSize
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.system(size: 11, weight: .medium)).foregroundStyle(.white.opacity(0.55))
            ZStack {
                LinearGradient(colors: [Color(red: 0.2, green: 0.26, blue: 0.36), Color(red: 0.12, green: 0.15, blue: 0.22)],
                               startPoint: .top, endPoint: .bottom)
                Color.white.mask {
                    content
                        .padding(16)
                        .environment(\.widgetRenderingMode, .accented)
                }
            }
            .frame(width: size.width, height: size.height)
            .clipShape(RoundedRectangle(cornerRadius: size.height < 200 ? 22 : 24, style: .continuous))
        }
    }
}

/// A sheet: a dark wallpaper with rows of cells.
struct Sheet<Content: View>: View {
    var title: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text(title).font(.system(size: 15, weight: .semibold)).foregroundStyle(.white.opacity(0.8))
            content
        }
        .padding(24)
        .background(LinearGradient(colors: [Color(white: 0.16), Color(white: 0.07)], startPoint: .top, endPoint: .bottom))
        .environment(\.colorScheme, .dark)
        .environment(\.displayScale, 2)
    }
}

@main
enum Render {
    @MainActor
    static func main() {
        let args = CommandLine.arguments
        guard args.count >= 2 else {
            print("usage: render OUT_DIR [unix time [zone]]")
            exit(2)
        }
        let out = URL(fileURLWithPath: args[1], isDirectory: true)
        let t = args.count > 2 ? Double(args[2]) ?? 1_791_460_800 : 1_791_460_800
        let zone = args.count > 3 ? args[3] : "UTC"
        RenderClock.now = Date(timeIntervalSince1970: t)
        let pure = WidgetWords(pure: true)
        let earth = WidgetWords(pure: false, zone: zone)
        let stamp = Notation.standard.stamp(at: t, upTo: "lambda")
        let tag = "t \(Int(t)) · \(stamp)"

        timelines(at: t, words: [pure, earth])

        write(Sheet(title: "Journal · \(tag)") {
            HStack(alignment: .top, spacing: 18) {
                ForEach([5, 4, 3, 0], id: \.self) { unit in
                    VStack(alignment: .leading, spacing: 18) {
                        ForEach(Size.small, id: \.width) { size in
                            HomeCell(title: "unit \(unit) · small \(Int(size.width))", size: size) {
                                JournalWidgetView(snapshot: JournalSnapshot(at: t, unit: unit, words: pure), size: .small)
                            }
                        }
                    }
                }
            }
            HStack(alignment: .top, spacing: 18) {
                ForEach([5, 4, 3, 1], id: \.self) { unit in
                    HomeCell(title: "unit \(unit) · large", size: Size.large[unit % 2]) {
                        JournalWidgetView(snapshot: JournalSnapshot(at: t, unit: unit, words: pure), size: .large)
                    }
                }
            }
            HStack(alignment: .top, spacing: 18) {
                HomeCell(title: "StandBy (no background)", size: Size.small[1], background: false) {
                    JournalWidgetView(snapshot: JournalSnapshot(at: t, unit: 5, words: pure), size: .small)
                }
                HomeCell(title: "unit 2 · small", size: Size.small[0]) {
                    JournalWidgetView(snapshot: JournalSnapshot(at: t, unit: 2, words: pure), size: .small)
                }
                HomeCell(title: "unit 1 · small", size: Size.small[0]) {
                    JournalWidgetView(snapshot: JournalSnapshot(at: t, unit: 1, words: pure), size: .small)
                }
                HomeCell(title: "out of range", size: Size.small[0]) {
                    JournalWidgetView(snapshot: nil, size: .small)
                }
                HomeCell(title: "out of range · large", size: Size.small[1]) {
                    JournalWidgetView(snapshot: nil, size: .large)
                }
            }
        }, to: out.appendingPathComponent("journal.png"))

        write(Sheet(title: "Clock · \(tag)") {
            ForEach([pure, earth], id: \.pure) { words in
                HStack(alignment: .top, spacing: 18) {
                    ForEach(Size.medium, id: \.width) { size in
                        HomeCell(title: "\(words.pure ? "pure" : "Earth \(zone)") · medium \(Int(size.width))", size: size) {
                            ClockWidgetView(snapshot: ClockSnapshot(at: t, words: words))
                        }
                    }
                }
            }
            HStack(alignment: .top, spacing: 18) {
                HomeCell(title: "out of range", size: Size.medium[0]) { ClockWidgetView(snapshot: nil) }
            }
        }, to: out.appendingPathComponent("clock.png"))

        write(Sheet(title: "Up next · \(tag)") {
            ForEach([pure, earth], id: \.pure) { words in
                let snapshot = UpNextSnapshot(at: t, words: words)
                HStack(alignment: .top, spacing: 18) {
                    VStack(alignment: .leading, spacing: 18) {
                        HomeCell(title: "\(words.pure ? "pure" : "Earth") · small", size: Size.small[0]) {
                            UpNextWidgetView(snapshot: snapshot, size: .small)
                        }
                        ForEach(Size.medium, id: \.width) { size in
                            HomeCell(title: "medium \(Int(size.width))", size: size) {
                                UpNextWidgetView(snapshot: snapshot, size: .medium)
                            }
                        }
                    }
                    VStack(alignment: .leading, spacing: 18) {
                        HomeCell(title: "large", size: Size.large[0]) {
                            UpNextWidgetView(snapshot: snapshot, size: .large)
                        }
                        // the shortest unit listed: from the Nuclide up
                        HomeCell(title: "medium · from the Nuclide", size: Size.medium[0]) {
                            UpNextWidgetView(snapshot: UpNextSnapshot(at: t, words: words, finest: 4), size: .medium)
                        }
                    }
                }
            }
        }, to: out.appendingPathComponent("upnext.png"))

        write(Sheet(title: "Rings · \(tag)") {
            ForEach([pure, earth], id: \.pure) { words in
                let snapshot = RingsSnapshot(at: t, words: words)
                HStack(alignment: .top, spacing: 18) {
                    VStack(alignment: .leading, spacing: 18) {
                        ForEach(Size.small, id: \.width) { size in
                            HomeCell(title: "\(words.pure ? "pure" : "Earth") · small \(Int(size.width))", size: size) {
                                RingsWidgetView(snapshot: snapshot, size: .small)
                            }
                        }
                    }
                    HomeCell(title: "large", size: Size.large[1]) {
                        RingsWidgetView(snapshot: snapshot, size: .large)
                    }
                }
            }
        }, to: out.appendingPathComponent("rings.png"))

        write(Sheet(title: "Tinted Home Screen (accented) · \(tag)") {
            HStack(alignment: .top, spacing: 18) {
                TintCell(title: "journal η", size: Size.small[0]) {
                    JournalWidgetView(snapshot: JournalSnapshot(at: t, unit: 5, words: pure), size: .small)
                }
                TintCell(title: "journal δ", size: Size.small[0]) {
                    JournalWidgetView(snapshot: JournalSnapshot(at: t, unit: 3, words: pure), size: .small)
                }
                TintCell(title: "rings", size: Size.small[0]) {
                    RingsWidgetView(snapshot: RingsSnapshot(at: t, words: pure), size: .small)
                }
                TintCell(title: "up next", size: Size.small[0]) {
                    UpNextWidgetView(snapshot: UpNextSnapshot(at: t, words: earth), size: .small)
                }
            }
            HStack(alignment: .top, spacing: 18) {
                TintCell(title: "clock · pure", size: Size.medium[0]) {
                    ClockWidgetView(snapshot: ClockSnapshot(at: t, words: pure))
                }
                TintCell(title: "up next · Earth", size: Size.medium[0]) {
                    UpNextWidgetView(snapshot: UpNextSnapshot(at: t, words: earth), size: .medium)
                }
            }
        }, to: out.appendingPathComponent("tinted.png"))

        write(Sheet(title: "Overview · \(tag)") {
            ForEach([pure, earth], id: \.pure) { words in
                HomeCell(title: "\(words.pure ? "pure" : "Earth") · extra large (iPad Pro 13″)", size: CGSize(width: 715, height: 330)) {
                    OverviewWidgetView(snapshot: OverviewSnapshot(at: t, words: words))
                }
            }
            HomeCell(title: "Mac · extra large", size: CGSize(width: 690, height: 322)) {
                OverviewWidgetView(snapshot: OverviewSnapshot(at: t, words: earth))
            }
        }, to: out.appendingPathComponent("overview.png"))

        write(Sheet(title: "Lock Screen · \(tag)") {
            let snapshot = AccessorySnapshot(at: t)
            HStack(alignment: .top, spacing: 24) {
                LockCell(title: "circular", size: Size.circular) { HelionGaugeView(snapshot: snapshot) }
                LockCell(title: "rectangular", size: Size.rectangular) { ClockRectangularView(snapshot: snapshot) }
                LockCell(title: "inline", size: Size.inline) { ClockInlineView(snapshot: snapshot) }
            }
            HStack(alignment: .top, spacing: 24) {
                LockCell(title: "circular · out", size: Size.circular) { HelionGaugeView(snapshot: nil) }
                LockCell(title: "rectangular · out", size: Size.rectangular) { ClockRectangularView(snapshot: nil) }
                // the colours the Home Screen would show (full colour)
                VStack(alignment: .leading, spacing: 6) {
                    Text("full colour").font(.system(size: 11, weight: .medium)).foregroundStyle(.white.opacity(0.55))
                    HStack(spacing: 18) {
                        HelionGaugeView(snapshot: snapshot).frame(width: 72, height: 72)
                        ClockRectangularView(snapshot: snapshot).frame(width: 160, height: 72)
                    }
                }
            }
        }, to: out.appendingPathComponent("lock.png"))

        // the Helion Arc at t and at the moments its lens is at either end, crossing the middle and moving on
        let clock = FractonicaClock.shared
        var arcs: [(String, Double)] = [("t", t)]
        if let helion = clock.level(at: t, 6), let preon = clock.level(at: t, 8) {
            arcs += [
                ("Helion start", helion.start + WidgetChange.settle),
                ("17ι, mid", helion.start + 17.5 / 36 * helion.duration),
                ("next Preon", preon.end + WidgetChange.settle),
                ("Helion end", helion.end - 1),
            ]
        }
        write(Sheet(title: "Helion Arc · \(tag)") {
            HStack(alignment: .top, spacing: 24) {
                ForEach(arcs, id: \.1) { name, at in
                    LockCell(title: "\(name) · rectangular", size: Size.rectangular) {
                        HelionArcView(snapshot: HelionArcSnapshot(at: at), size: .rectangular)
                    }
                }
            }
            HStack(alignment: .top, spacing: 18) {
                ForEach(arcs, id: \.1) { name, at in
                    HomeCell(title: "\(name) · small", size: Size.small[0]) {
                        HelionArcView(snapshot: HelionArcSnapshot(at: at), size: .small)
                    }
                }
            }
            HStack(alignment: .top, spacing: 18) {
                ForEach(Size.medium, id: \.width) { size in
                    HomeCell(title: "medium \(Int(size.width))", size: size) {
                        HelionArcView(snapshot: HelionArcSnapshot(at: t), size: .medium)
                    }
                }
                HomeCell(title: "medium · \(arcs.last?.0 ?? "")", size: Size.medium[0]) {
                    HelionArcView(snapshot: HelionArcSnapshot(at: arcs.last?.1 ?? t), size: .medium)
                }
            }
            HStack(alignment: .top, spacing: 18) {
                HomeCell(title: "small 170", size: Size.small[1]) {
                    HelionArcView(snapshot: HelionArcSnapshot(at: t), size: .small)
                }
                HomeCell(title: "StandBy (no background)", size: Size.small[1], background: false) {
                    HelionArcView(snapshot: HelionArcSnapshot(at: t), size: .small)
                }
                TintCell(title: "tinted · small", size: Size.small[0]) {
                    HelionArcView(snapshot: HelionArcSnapshot(at: t), size: .small)
                }
                TintCell(title: "tinted · medium", size: Size.medium[0]) {
                    HelionArcView(snapshot: HelionArcSnapshot(at: t), size: .medium)
                }
            }
            HStack(alignment: .top, spacing: 18) {
                LockCell(title: "rectangular · out", size: Size.rectangular) { HelionArcView(snapshot: nil, size: .rectangular) }
                HomeCell(title: "out of range", size: Size.small[0]) { HelionArcView(snapshot: nil, size: .small) }
                HomeCell(title: "out of range · medium", size: Size.medium[0]) { HelionArcView(snapshot: nil, size: .medium) }
            }
        }, to: out.appendingPathComponent("helionarc.png"))
    }

    /// Builds every widget's timeline from t as its provider does, and reports its size and cost: a timeline must be
    /// cheap to make (the extension has a few seconds) and stay within its entry budget.
    static func timelines(at t: Double, words: [WidgetWords]) {
        let now = Date(timeIntervalSince1970: t)
        func report<S>(_ name: String, _ make: () -> Timeline<SnapshotEntry<S>>) {
            let clock = ContinuousClock()
            var timeline: Timeline<SnapshotEntry<S>>?
            let elapsed = clock.measure { timeline = make() }
            guard let timeline else { return }
            let entries = timeline.entries
            let span = (entries.last!.date.timeIntervalSince(entries.first!.date) / 60).rounded()
            let empty = entries.filter { $0.snapshot == nil }.count
            print("timeline \(name): \(entries.count) entries over \(Int(span)) min, \(empty) empty, policy \(timeline.policy), built in \(elapsed)")
        }
        for unit in JournalSnapshot.units {
            report("journal unit \(unit)") { SnapshotTimeline.timeline(now: now, changes: { _ in JournalSnapshot.changes(unit: unit) }) { JournalSnapshot(at: $0, unit: unit) } }
        }
        for w in words {
            let mode = w.pure ? "pure" : "earth"
            report("clock \(mode)") { SnapshotTimeline.timeline(now: now, changes: { _ in ClockSnapshot.changes(words: w) }) { ClockSnapshot(at: $0, words: w) } }
            report("up next \(mode)") { SnapshotTimeline.timeline(now: now, changes: { UpNextSnapshot.changes(at: $0, words: w) }) { UpNextSnapshot(at: $0, words: w) } }
            report("rings \(mode)") { SnapshotTimeline.timeline(now: now, changes: { _ in RingsSnapshot.changes(words: w) }) { RingsSnapshot(at: $0, words: w) } }
            report("overview \(mode)") { SnapshotTimeline.timeline(now: now, changes: { OverviewSnapshot.changes(at: $0, words: w) }) { OverviewSnapshot(at: $0, words: w) } }
        }
        report("lock") { SnapshotTimeline.timeline(now: now, changes: { _ in AccessorySnapshot.changes }) { AccessorySnapshot(at: $0) } }
        report("helion arc") { SnapshotTimeline.timeline(now: now, changes: { _ in HelionArcSnapshot.changes }) { HelionArcSnapshot(at: $0) } }
    }

    @MainActor
    static func write(_ view: some View, to url: URL) {
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        guard let image = renderer.cgImage,
              let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
            print("could not render \(url.lastPathComponent)")
            exit(1)
        }
        CGImageDestinationAddImage(destination, image, nil)
        CGImageDestinationFinalize(destination)
        print(url.path)
    }
}
