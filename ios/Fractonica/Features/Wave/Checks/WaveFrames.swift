import FractonicaKit
import ImageIO
import SwiftUI
import UniformTypeIdentifiers

// Frames of the real stage rendered offscreen (ImageRenderer), at chosen instants of its transitions, plus the time a
// frame takes. Run with WAVE_FRAMES=<folder> to write PNGs there:
//
//     WAVE_FRAMES=/tmp/frames ios/scripts/check.sh ios/Fractonica/Features/Wave/Checks

@MainActor
enum WaveFrames {
    static func input(_ words: WaveWords, level: Int, overview: Bool = false, solar: Bool = false, size: CGSize) -> WaveFrameInput {
        WaveFrameInput(
            overview: overview, level: level, eff: level, solar: solar, words: words, reduceMotion: false,
            focusPad: WavePad(l: 28, r: 28, t: 24 + 52, b: 34 + 68), overviewPad: WavePad(l: 20, r: 20, t: 8 + 104, b: 14 + 68),
            avoid: [WaveRect(x0: size.width - 56, y0: 6, x1: size.width - 4, y1: 110), WaveRect(x0: 4, y0: size.height - 72, x1: size.width - 4, y1: size.height - 4)],
            touch: true
        )
    }

    /// Renders one frame of `stage` at displayed time t and stage time `now`.
    static func frame(_ stage: WaveStage, t: Double, input: WaveFrameInput, now: Double, size: CGSize) -> CGImage? {
        let view = Canvas { context, s in
            if stage.update(size: s, t: t, input: input, now: now) { stage.draw(&context, now: now) }
        }
        .frame(width: size.width, height: size.height)
        .background(Theme.background)
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        return renderer.cgImage
    }

    static func write(_ image: CGImage?, _ url: URL) {
        guard let image, let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else { return }
        CGImageDestinationAddImage(dest, image, nil)
        CGImageDestinationFinalize(dest)
    }

    static func run(into dir: String) {
        let folder = URL(fileURLWithPath: dir, isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let size = CGSize(width: 393, height: 520)
        let utc = TimeZone(identifier: "UTC")!
        let stage = WaveStage()
        let words = WaveWords(wording: Wording(pure: false, timeZone: utc), engine: stage.engine)
        let a = 1791460800.0
        var n = 0
        func shot(_ name: String, level: Int, overview: Bool = false, solar: Bool = false, now: Double, t: Double = a) {
            write(frame(stage, t: t, input: input(words, level: level, overview: overview, solar: solar, size: size), now: now, size: size),
                  folder.appendingPathComponent(String(format: "%02d-%@.png", n, name)))
            n += 1
        }
        // δ, then one depth deeper (ε): the camera glides from the δ arc into its child
        shot("delta", level: 3, now: 0)
        shot("delta-settled", level: 3, now: 1)
        for (i, dt) in [0.0, 0.08, 0.16, 0.26, 0.6].enumerated() { shot("to-eps-\(i)", level: 4, now: 2 + dt) }
        // two depths in at once (ε → η)
        for (i, dt) in [0.05, 0.15, 0.3, 0.8].enumerated() { shot("to-eta-\(i)", level: 6, now: 4 + dt) }
        // out to the catalogue
        for (i, dt) in [0.05, 0.2, 0.4, 1].enumerated() { shot("to-all-\(i)", level: 6, overview: true, now: 6 + dt) }
        // a pinch that changes depth: the next scene starts from the pinched view
        shot("ov-settled", level: 0, overview: true, now: 8)
        stage.setUser(WaveUserTransform(scale: 1.5, anchor: WavePoint(x: 200, y: 260), translation: WavePoint(x: 0, y: 0)))
        shot("pinched", level: 0, overview: true, now: 8.1)
        stage.commitUser()
        for (i, dt) in [0.02, 0.15, 0.6].enumerated() { shot("pinch-to-alpha-\(i)", level: 0, now: 8.2 + dt) }
        // the solar ripple at δ, and a time-lapse frame (time moved on: the markers moved)
        shot("solar-delta-start", level: 3, solar: true, now: 10)
        shot("solar-delta", level: 3, solar: true, now: 11)
        shot("solar-delta-later", level: 3, solar: true, now: 11.5, t: a + 86400 * 1.5)
        // a deep zoom: δ to ξ in one move
        for (i, dt) in [0.04, 0.1, 0.18, 0.26, 0.36, 0.5, 0.7, 1.5].enumerated() { shot("to-xi-\(i)", level: 13, now: 13 + dt) }
        // and all the way out to the catalogue
        for (i, dt) in [0.05, 0.15, 0.3, 0.5, 0.7, 1.5].enumerated() { shot("to-all-deep-\(i)", level: 13, overview: true, now: 16 + dt) }

        // a short, wide stage (an iPhone in landscape beside its reading panel), η and the catalogue
        let short = CGSize(width: 520, height: 290)
        let shortInput = { (overview: Bool) in
            WaveFrameInput(
                overview: overview, level: 6, eff: 6, solar: true, words: words, reduceMotion: false,
                focusPad: WavePad(l: 40, r: 66, t: 16, b: 10 + 72), overviewPad: WavePad(l: 28, r: 84, t: 12, b: 10 + 72),
                avoid: [WaveRect(x0: short.width - 62, y0: 6, x1: short.width - 10, y1: 110), WaveRect(x0: 10, y0: short.height - 72, x1: short.width - 10, y1: short.height - 4)],
                touch: true)
        }
        let landscape = WaveStage()
        write(frame(landscape, t: a, input: shortInput(false), now: 0, size: short), folder.appendingPathComponent("90-landscape-eta.png"))
        let landscape2 = WaveStage()
        write(frame(landscape2, t: a, input: shortInput(true), now: 0, size: short), folder.appendingPathComponent("91-landscape-all.png"))

        // the cost of a frame (render included, so an upper bound for update + draw)
        let input6 = input(words, level: 6, size: size)
        let clock = ContinuousClock()
        let count = 60
        let elapsed = clock.measure {
            for i in 0..<count { _ = frame(stage, t: a + Double(i) * 0.016, input: input6, now: 20 + Double(i) * 0.016, size: size) }
        }
        print("frames written to \(folder.path); one live frame at η renders in \(elapsed / count)")
    }
}
