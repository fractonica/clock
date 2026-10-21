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
                        HomeCell(title: "medium", size: Size.medium[1]) {
                            UpNextWidgetView(snapshot: snapshot, size: .medium)
                        }
                    }
                    HomeCell(title: "large", size: Size.large[0]) {
                        UpNextWidgetView(snapshot: snapshot, size: .large)
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
