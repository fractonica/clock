@preconcurrency import AVFoundation
import CoreGraphics
import CoreVideo
import Foundation

/// Sample entries for screenshots and first looks (`-FXJournalSeed 1`, only into an empty journal): a week of posts
/// spread over several Helions, with generated photos, a short generated video and synthesized voice notes, varied
/// emoji and Markdown. Never runs on its own.
enum JournalSeed {
    @MainActor
    static func fillIfEmpty(_ store: JournalStore) async {
        guard store.records.isEmpty else { return }
        let disk = store.disk
        let now = Date().timeIntervalSince1970
        let zone = AppSettings.shared.zone ?? TimeZone.current.identifier

        func photo(_ scene: Scene) async -> [BlobRef] {
            guard let image = render(scene, width: 1600, height: 1200),
                  let item = try? JournalMedia.encodePhoto(image, disk: disk) else { return [] }
            return (try? await store.adopt(item)) ?? []
        }
        func voice(_ seconds: Double, seed: UInt64) async -> [BlobRef] {
            let url = disk.temporaryFile(ext: "m4a")
            guard (try? synthesizeVoice(to: url, seconds: seconds, seed: seed)) != nil,
                  let item = try? await JournalMedia.processAudio(url, disk: disk, move: true) else { return [] }
            return (try? await store.adopt(item)) ?? []
        }
        func video() async -> [BlobRef] {
            let url = disk.temporaryFile(ext: "mov")
            guard (try? await makeVideo(to: url)) != nil,
                  let item = try? await JournalMedia.processVideo(url, quality: .original, disk: disk) else { return [] }
            try? FileManager.default.removeItem(at: url)
            return (try? await store.adopt(item)) ?? []
        }

        let entries: [(ago: Double, emoji: String?, title: String?, markdown: String, media: () async -> [BlobRef])] = [
            (40 * 60, "🌙", "Night walk", """
            The **moon** came up huge and orange over the river — I stopped on the bridge until it turned silver.

            - [x] call Ana back
            - [ ] print the new Delta pages
            """, { await photo(.moon) + voice(9, seed: 7) }),
            (3.2 * 3600, "☕️", "Slow morning", """
            Coffee on the balcony, no phone for an hour. *This* is the pace I want for the whole Nuclide.

            > Time is the substance I am made of. — Borges
            """, { [] }),
            (7.5 * 3600, "🌅", "Sunrise from the bridge", "Up before the alarm for once. Ten minutes of colour, then grey again.", { await photo(.sunrise) + photo(.fields) + video() }),
            (1.3 * 86_400, "📚", "Reading notes", """
            ## The Clock of the Long Now

            1. Slow is a feature
            2. Think in centuries, act in Helions
            3. Leave things better than you found them

            Started *Einstein's Dreams* again — every chapter is a different kind of time.
            """, { [] }),
            (2.4 * 86_400, "🎧", nil, "", { await voice(14, seed: 21) }),
            (4.1 * 86_400, "🌊", "Sea day", "Cold water, warm stones. Three hours that felt like ten minutes.", { await photo(.sea) + photo(.dusk) + photo(.fields) + photo(.moon) }),
            (6.2 * 86_400, "💡", "Idea: a clock you can hear", """
            What if every **Preon** had its own chord? The ladder as music:

            - η as the drone
            - ι as the melody
            - λ as the rhythm

            Sketch it in `SoundEngine` first, then [read up on just intonation](https://en.wikipedia.org/wiki/Just_intonation).
            """, { [] }),
        ]
        for e in entries {
            let blobs = await e.media()
            let record = HubRecord.journalEntry(time: now - e.ago, zone: zone, entry: JournalEntry(emoji: e.emoji, title: e.title, markdown: e.markdown), blobs: blobs, now: now)
            store.save(record)
        }
        // a record of another kind, as the hub would send it (shown with Records from Other Sources)
        let sensor = HubRecord(id: "temp:studio:\(Int(now - 5400))", kind: "sensor.temperature", time: now - 5400, end: nil, zone: nil,
                               data: .object(["celsius": .number(21.5), "where": .string("studio"), "emoji": .string("🌡️"), "title": .string("Studio temperature")]),
                               text: nil, tags: nil, blobs: nil, created: now - 5400, updated: now - 5400, deleted: nil, source: "c_sensor", rev: 1)
        store.applyRemote(sensor)
    }

    // MARK: A wide journal

    /// `-FXJournalSeed wide`: after the sample week, about 330 more entries over the last three years — denser lately,
    /// with bursts of several within minutes and a few sharing one moment — so the stack's Delta, Gamma and Beta blocks
    /// and the wave's clusters have something to show. A handful of pictures are made once and shared. Added once
    /// (its ids are fixed), never on its own.
    @MainActor
    static func fillWide(_ store: JournalStore) async {
        guard store.record(wideID(0)) == nil else { return }
        let disk = store.disk
        let now = Date().timeIntervalSince1970
        let zone = AppSettings.shared.zone ?? TimeZone.current.identifier
        var pictures: [[BlobRef]] = []
        for scene in [Scene.moon, .sunrise, .fields, .sea, .dusk] {
            // the sample week's size: some simulators' HEIC decoder stalls on smaller generated pictures
            guard let image = render(scene, width: 1600, height: 1200),
                  let item = try? JournalMedia.encodePhoto(image, disk: disk),
                  let blobs = try? await store.adopt(item) else { continue }
            pictures.append(blobs)
        }
        var rng: UInt64 = 0x5EED_F00D
        func random() -> Double {
            rng ^= rng << 13; rng ^= rng >> 7; rng ^= rng << 17
            return Double(rng % 1_000_000) / 1_000_000
        }
        let emoji = ["🌙", "☕️", "🌅", "📚", "🎧", "🌊", "💡", "🏃", "🍜", "🎨", "🌱", "✈️", "🎂", "🧘", "🚲", "📷", "🎹", "🍷",
                     "🌧️", "❄️", "🔥", "🏔️", "🐈", "🎬", "🧩", "🛠️", "🌻", "🎉"]
        let titles = ["Morning pages", "Long walk", "Rain all day", "New idea", "Dinner with friends", "Quiet evening",
                      "Training", "Road trip", "Studio time", "Reading", "Market", "First snow", "Birthday", "Garden",
                      "Late call", "Museum", "Concert", "Fixing the bike", "Sunday", "Notes"]
        let lines = ["Wrote before anyone was up.", "The light at the end of the Helion was unreal.", "Nothing much, and that was good.",
                     "Sketched the next Delta's plan.", "Too much coffee, not enough sleep.", "Everything smelled of rain.",
                     "Finally finished it.", "A small thing that made the day.", ""]
        let year = 365.25 * 86_400
        var moments: [Double] = []
        for _ in 0..<270 {
            moments.append(now - 2 * 3600 - 3.1 * year * pow(random(), 1.7))
        }
        // bursts: several entries within a few minutes, and a few sharing one moment
        for b in 0..<12 {
            let at = now - 3 * 3600 - 2.8 * year * pow(random(), 1.4)
            let n = 4 + Int(random() * 4)
            for i in 0..<n { moments.append(at - Double(i) * (b % 4 == 0 ? 2 : 60 + random() * 240)) }
        }
        for (i, t) in moments.sorted(by: >).enumerated() {
            let hasEmoji = random() > 0.08
            let entry = JournalEntry(emoji: hasEmoji ? emoji[Int(random() * Double(emoji.count)) % emoji.count] : nil,
                                     title: titles[Int(random() * Double(titles.count)) % titles.count],
                                     markdown: lines[Int(random() * Double(lines.count)) % lines.count])
            var blobs: [BlobRef] = []
            if !pictures.isEmpty, random() < 0.28 {
                let count = 1 + Int(random() * 3)
                for j in 0..<count { blobs += pictures[(i + j * 2) % pictures.count] }
            }
            let record = HubRecord.journalEntry(id: wideID(i), time: t, zone: zone, entry: entry, blobs: blobs, now: now)
            store.save(record)
        }
    }

    static func wideID(_ n: Int) -> String { "seed.wide.\(n)" }

    // MARK: Pictures

    enum Scene { case moon, sunrise, fields, sea, dusk }

    /// A soft, photographic-looking landscape drawn with gradients.
    static func render(_ scene: Scene, width: Int, height: Int) -> CGImage? {
        guard let ctx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        let w = CGFloat(width), h = CGFloat(height)
        func color(_ hex: UInt32, _ a: CGFloat = 1) -> CGColor {
            CGColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: a)
        }
        func sky(_ top: UInt32, _ bottom: UInt32) {
            let g = CGGradient(colorsSpace: nil, colors: [color(bottom), color(top)] as CFArray, locations: [0, 1])!
            ctx.drawLinearGradient(g, start: .zero, end: CGPoint(x: 0, y: h), options: [])
        }
        func glow(_ x: CGFloat, _ y: CGFloat, _ r: CGFloat, _ c: UInt32, _ a: CGFloat) {
            let g = CGGradient(colorsSpace: nil, colors: [color(c, a), color(c, 0)] as CFArray, locations: [0, 1])!
            ctx.drawRadialGradient(g, startCenter: CGPoint(x: x, y: y), startRadius: 0, endCenter: CGPoint(x: x, y: y), endRadius: r, options: [])
        }
        func disc(_ x: CGFloat, _ y: CGFloat, _ r: CGFloat, _ c: UInt32) {
            ctx.setFillColor(color(c))
            ctx.fillEllipse(in: CGRect(x: x - r, y: y - r, width: 2 * r, height: 2 * r))
        }
        func hills(_ base: CGFloat, _ amp: CGFloat, _ freq: CGFloat, _ phase: CGFloat, _ c: UInt32) {
            let path = CGMutablePath()
            path.move(to: CGPoint(x: 0, y: 0))
            for i in 0...100 {
                let x = w * CGFloat(i) / 100
                let y = base + amp * sin(x / w * .pi * freq + phase) + amp * 0.4 * sin(x / w * .pi * freq * 2.7 + phase * 1.7)
                path.addLine(to: CGPoint(x: x, y: y))
            }
            path.addLine(to: CGPoint(x: w, y: 0))
            path.closeSubpath()
            ctx.addPath(path)
            ctx.setFillColor(color(c))
            ctx.fillPath()
        }
        switch scene {
        case .moon:
            sky(0x0B1430, 0x27305A)
            for i in 0..<120 {
                let x = CGFloat((i * 7919) % width), y = h * 0.35 + CGFloat((i * 104_729) % Int(h * 0.65))
                disc(x, y, CGFloat(i % 3) * 0.8 + 0.8, 0xDDE6FF)
            }
            glow(w * 0.68, h * 0.7, h * 0.45, 0xF4E7C8, 0.35)
            disc(w * 0.68, h * 0.7, h * 0.11, 0xF6EFD9)
            disc(w * 0.66, h * 0.72, h * 0.022, 0xE2D6B8)
            disc(w * 0.70, h * 0.67, h * 0.015, 0xE2D6B8)
            hills(h * 0.3, h * 0.05, 2.2, 0.6, 0x141C33)
            hills(h * 0.18, h * 0.04, 3.1, 2.0, 0x0C1222)
            ctx.setFillColor(color(0xF6EFD9, 0.18))
            for i in 0..<14 { ctx.fill(CGRect(x: w * 0.6 + CGFloat(i % 4) * 14, y: h * 0.06 + CGFloat(i) * 9, width: w * 0.12 - CGFloat(i) * 5, height: 3)) }
        case .sunrise:
            sky(0x3B5B9A, 0xF7A86B)
            glow(w * 0.42, h * 0.32, h * 0.7, 0xFFD27F, 0.8)
            disc(w * 0.42, h * 0.32, h * 0.08, 0xFFF1C9)
            hills(h * 0.3, h * 0.04, 1.6, 1.0, 0x5A4E73)
            hills(h * 0.2, h * 0.05, 2.4, 0.2, 0x2E2A44)
            ctx.setFillColor(color(0x1B1A2C))
            ctx.fill(CGRect(x: 0, y: h * 0.12, width: w, height: h * 0.02))
            for i in 0..<9 { ctx.fill(CGRect(x: w * CGFloat(i) / 8 - 6, y: 0, width: 12, height: h * 0.13)) }
        case .fields:
            sky(0x6FA8DC, 0xD7ECF7)
            glow(w * 0.8, h * 0.85, h * 0.5, 0xFFFFFF, 0.6)
            hills(h * 0.45, h * 0.06, 1.3, 2.4, 0x7FB069)
            hills(h * 0.33, h * 0.05, 2.0, 0.4, 0x5C9447)
            hills(h * 0.2, h * 0.04, 2.8, 1.4, 0x3E7234)
        case .sea:
            sky(0x4A90C2, 0xBFE3F2)
            glow(w * 0.25, h * 0.85, h * 0.4, 0xFFFFFF, 0.7)
            ctx.setFillColor(color(0x1F6F9F))
            ctx.fill(CGRect(x: 0, y: 0, width: w, height: h * 0.45))
            for i in 0..<18 {
                ctx.setFillColor(color(0xE8F6FF, 0.25))
                ctx.fill(CGRect(x: CGFloat((i * 211) % width), y: h * 0.05 + CGFloat(i) * h * 0.022, width: w * 0.2, height: 3))
            }
            hills(h * 0.08, h * 0.03, 1.2, 3.0, 0xE6D3A8)
        case .dusk:
            sky(0x1E2246, 0xC0607A)
            glow(w * 0.5, h * 0.25, h * 0.6, 0xFF8A65, 0.6)
            hills(h * 0.27, h * 0.06, 1.8, 0.9, 0x2D2140)
            disc(w * 0.82, h * 0.82, h * 0.012, 0xFFFFFF)
        }
        return ctx.makeImage()
    }

    // MARK: Sound

    /// A voice-like murmur: a gliding pitch with harmonics, shaped into syllables and pauses, as AAC .m4a.
    static func synthesizeVoice(to url: URL, seconds: Double, seed: UInt64) throws {
        let rate = 22_050.0
        let settings: [String: Any] = [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: rate, AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 48_000]
        let file = try AVAudioFile(forWriting: url, settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false)
        let format = file.processingFormat
        let total = Int(seconds * rate)
        let chunk = 4096
        var rng = seed | 1
        func random() -> Double {
            rng ^= rng << 13; rng ^= rng >> 7; rng ^= rng << 17
            return Double(rng % 10_000) / 10_000
        }
        // syllables: start, length, pitch
        var syllables: [(Double, Double, Double)] = []
        var t = 0.25
        while t < seconds - 0.3 {
            let len = 0.12 + random() * 0.22
            syllables.append((t, len, 120 + random() * 70))
            t += len + (random() < 0.18 ? 0.45 + random() * 0.4 : 0.04 + random() * 0.08)
        }
        var phase = 0.0
        var written = 0
        while written < total {
            let n = min(chunk, total - written)
            guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(n)) else { break }
            buffer.frameLength = AVAudioFrameCount(n)
            let out = buffer.floatChannelData![0]
            for i in 0..<n {
                let time = Double(written + i) / rate
                var env = 0.0
                var pitch = 140.0
                for s in syllables where time >= s.0 && time < s.0 + s.1 {
                    let x = (time - s.0) / s.1
                    env = sin(.pi * x)
                    pitch = s.2 * (1 + 0.08 * sin(.pi * x))
                }
                phase += 2 * .pi * pitch / rate
                let voice = sin(phase) + 0.5 * sin(2 * phase) + 0.25 * sin(3 * phase) + 0.12 * sin(5 * phase)
                out[i] = Float(0.22 * env * voice + 0.004 * (random() - 0.5))
            }
            try file.write(from: buffer)
            written += n
        }
    }

    // MARK: Video

    /// Four seconds of a slow sunrise, H.264 640×360.
    static func makeVideo(to url: URL) async throws {
        let width = 640, height = 360, fps: Int32 = 20, frames = 80
        let writer = try AVAssetWriter(outputURL: url, fileType: .mov)
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: width, AVVideoHeightKey: height,
        ])
        input.expectsMediaDataInRealTime = false
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA, kCVPixelBufferWidthKey as String: width,
            kCVPixelBufferHeightKey as String: height,
        ])
        writer.add(input)
        guard writer.startWriting() else { throw writer.error ?? CocoaError(.fileWriteUnknown) }
        writer.startSession(atSourceTime: .zero)
        for f in 0..<frames {
            while !input.isReadyForMoreMediaData { try await Task.sleep(for: .milliseconds(5)) }
            guard let pool = adaptor.pixelBufferPool else { break }
            var buffer: CVPixelBuffer?
            CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer)
            guard let buffer else { break }
            CVPixelBufferLockBaseAddress(buffer, [])
            if let ctx = CGContext(data: CVPixelBufferGetBaseAddress(buffer), width: width, height: height, bitsPerComponent: 8,
                                   bytesPerRow: CVPixelBufferGetBytesPerRow(buffer), space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                   bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue),
               let frame = render(.sunrise, width: width, height: height) {
                ctx.draw(frame, in: CGRect(x: 0, y: CGFloat(f) * 0.6 - 24, width: CGFloat(width), height: CGFloat(height) + 48))
            }
            CVPixelBufferUnlockBaseAddress(buffer, [])
            adaptor.append(buffer, withPresentationTime: CMTime(value: CMTimeValue(f), timescale: fps))
        }
        input.markAsFinished()
        await writer.finishWriting()
        if writer.status != .completed { throw writer.error ?? CocoaError(.fileWriteUnknown) }
    }
}
