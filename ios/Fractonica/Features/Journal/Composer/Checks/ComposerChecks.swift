@preconcurrency import AVFoundation
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// The composer's pure logic: the emoji set and its random pick and search, the capture dates of media (EXIF, QuickTime,
/// the picker's options) and the progress of media on their way in.
@main
struct ComposerChecks {
    static func main() async {
        emojiSet()
        emojiRandom()
        emojiSearch()
        exifParsing()
        isoParsing()
        imageFiles()
        await movieFiles()
        captureOptions()
        pendingProgress()
        Checks.finish()
    }

    // MARK: Emoji

    static func emojiSet() {
        let all = EmojiCatalog.all
        check(all.count == EmojiData.count, "the table holds what its header says: \(all.count) vs \(EmojiData.count)")
        check(all.count > 1800, "every emoji, not a sample: \(all.count)")
        check(Set(all.map(\.emoji)).count == all.count, "each emoji once")
        check(all.allSatisfy { $0.emoji.count == 1 }, "each emoji is one character (ZWJ sequences, flags and keycaps included)")
        check(all.allSatisfy { !$0.name.isEmpty }, "each emoji has a name")
        let tones: ClosedRange<UInt32> = 0x1F3FB...0x1F3FF
        check(!all.contains { $0.emoji.unicodeScalars.contains { tones.contains($0.value) } }, "skin-tone variants are folded into their base")
        // components (skin-tone swatches, hair) are not emoji to choose
        check(!all.contains { $0.emoji == "\u{1F9B0}" || $0.emoji == "\u{1F3FB}" }, "components are left out")
        // fully-qualified: the heart and the airplane carry their emoji presentation selector
        check(all.contains { $0.emoji == "\u{2764}\u{FE0F}" } && !all.contains { $0.emoji == "\u{2764}" }, "red heart fully qualified")
        check(all.contains { $0.emoji == "\u{2708}\u{FE0F}" }, "airplane fully qualified")
        // Emoji 16.0 (iOS 18.4) is in; 17.0 (iOS 26.4) is not, iOS 18.6 cannot draw it
        check(all.contains { $0.emoji == "\u{1FAE9}" }, "face with bags under eyes (16.0) is in")
        check(all.contains { $0.emoji == "\u{1F1E8}\u{1F1F6}" }, "flag: Sark (16.0) is in")
        check(!all.contains { $0.emoji.unicodeScalars.contains { $0.value == 0x1FAEA || $0.value == 0x1F6D8 || $0.value == 0x1FAC8 } },
              "nothing newer than Emoji 16.0")
        check(all.contains { $0.emoji == "👨‍👩‍👧‍👦" } && all.contains { $0.emoji == "🏴‍☠️" } && all.contains { $0.emoji == "#️⃣" },
              "sequences are in: family, pirate flag, keycap")

        let categories = EmojiCatalog.categories
        check(categories.map(\.title) == ["Smileys & Emotion", "People & Body", "Animals & Nature", "Food & Drink", "Travel & Places",
                                          "Activities", "Objects", "Symbols", "Flags"], "Unicode's groups, in order: \(categories.map(\.title))")
        check(categories.reduce(0) { $0 + $1.emoji.count } == all.count, "every emoji in exactly one section")
        check(Set(categories.map(\.id)).count == categories.count, "section ids are unique")
        let set = Set(all.map(\.emoji))
        check(categories.allSatisfy { set.contains($0.icon) }, "section icons are emoji of the set: \(categories.map(\.icon))")
    }

    static func emojiRandom() {
        // uniform over the whole set: each section's share of many draws is its share of the emoji
        var generator = SeededGenerator(seed: 0x5EED)
        let draws = 200_000
        var hits: [String: Int] = [:]
        var seen = Set<String>()
        let section = Dictionary(EmojiCatalog.categories.flatMap { c in c.emoji.map { ($0, c.id) } }, uniquingKeysWith: { a, _ in a })
        for _ in 0..<draws {
            let emoji = EmojiCatalog.random(using: &generator)
            seen.insert(emoji)
            hits[section[emoji] ?? "?", default: 0] += 1
        }
        let total = Double(EmojiCatalog.all.count)
        for category in EmojiCatalog.categories {
            let expected = Double(draws) * Double(category.emoji.count) / total
            let got = Double(hits[category.id] ?? 0)
            // well within five standard deviations of a binomial count
            let sd = (expected * (1 - Double(category.emoji.count) / total)).squareRoot()
            check(abs(got - expected) < 5 * sd, "\(category.title): \(Int(got)) draws, \(Int(expected)) expected")
        }
        check(hits["?"] == nil, "every draw is in the set")
        check(seen.count > Int(total * 0.99), "the draws reach nearly every emoji: \(seen.count) of \(Int(total))")
        check(!EmojiCatalog.random().isEmpty, "the system generator draws one too")
    }

    static func emojiSearch() {
        check(EmojiCatalog.search("red heart").first == "❤️", "red heart first: \(EmojiCatalog.search("red heart").prefix(3))")
        check(EmojiCatalog.search("flag japan").first == "🇯🇵", "flag: Japan")
        check(EmojiCatalog.search("moon").contains("🌕"), "moon finds the full moon")
        check(EmojiCatalog.search("coffee").contains("☕"), "coffee finds the hot beverage (a CLDR keyword)")
        check(EmojiCatalog.search("happy").count > 5, "happy finds faces by their keywords")
        check(EmojiCatalog.search("Grinning").first == "😀", "case does not matter")
        let smiling = EmojiCatalog.search("smiling")
        check(smiling.contains("😀"), "a subgroup word finds its emoji (grinning face is face-smiling)")
        check(smiling.firstIndex(of: "😊") ?? .max < smiling.firstIndex(of: "😀") ?? 0, "names before subgroups")
        check(EmojiCatalog.search("🌙") == ["🌙"], "the emoji itself")
        check(EmojiCatalog.search("zzqqx").isEmpty && EmojiCatalog.search("  ").isEmpty, "nothing for nonsense or blanks")
        check(EmojiCatalog.name("😀") == "grinning face", "CLDR name: \(EmojiCatalog.name("😀"))")
        check(EmojiCatalog.name("👍🏽").contains("thumbs up"), "a skin-tone variant still has a name: \(EmojiCatalog.name("👍🏽"))")
    }

    // MARK: Capture dates

    static let kyiv = TimeZone(identifier: "Europe/Kyiv")!
    static let utc = TimeZone(secondsFromGMT: 0)!
    /// 2026-10-08 05:12:30 UTC.
    static let sunrise = 1_791_436_350.0

    static func exifParsing() {
        check(MediaCapture.exifDate("2026:10:08 07:12:30", offset: "+02:00", subsec: nil, zone: utc) == sunrise, "EXIF with its offset")
        check(MediaCapture.exifDate("2026:10:08 07:12:30", offset: nil, subsec: nil, zone: kyiv) == sunrise - 3600,
              "EXIF without an offset reads in the entry's zone (Kyiv, UTC+3 in October)")
        check(MediaCapture.exifDate("2026:10:08 05:12:30", offset: "Z", subsec: "25", zone: kyiv) == sunrise + 0.25, "fraction of a second")
        check(MediaCapture.exifDate("2026:10:08 07:12:30\0", offset: "+0200", subsec: nil, zone: utc) == sunrise, "a trailing NUL, a compact offset")
        check(MediaCapture.exifDate("0000:00:00 00:00:00", offset: nil, subsec: nil, zone: utc) == nil, "an unset EXIF date is none")
        check(MediaCapture.exifDate("yesterday", offset: nil, subsec: nil, zone: utc) == nil, "garbage is none")
        check(MediaCapture.exifDate("2026:10:08 07:12:30", offset: "+99:00", subsec: nil, zone: kyiv) == sunrise - 3600,
              "an impossible offset falls back to the zone")
        check(MediaCapture.offsetSeconds("+02:00") == 7200 && MediaCapture.offsetSeconds("-0530") == -19800
              && MediaCapture.offsetSeconds("Z") == 0 && MediaCapture.offsetSeconds("+02") == 7200, "offsets")
        check(MediaCapture.offsetSeconds("+2") == nil && MediaCapture.offsetSeconds("02:00") == nil, "malformed offsets")
    }

    static func isoParsing() {
        let t = 1_791_441_300.0   // 2026-10-08 06:35:00 UTC
        check(MediaCapture.isoDate("2026-10-08T09:35:00+0300") == t, "QuickTime's compact offset")
        check(MediaCapture.isoDate("2026-10-08T09:35:00+03:00") == t, "ISO offset")
        check(MediaCapture.isoDate("2026-10-08T06:35:00Z") == t, "Z")
        check(MediaCapture.isoDate("2026-10-08T06:35:00") == t, "no offset: UTC")
        check(MediaCapture.isoDate("2026-10-08T06:35:00.250Z") == t + 0.25, "a fraction")
        check(MediaCapture.isoDate("2026-10-08T06:35:00 nonsense") == nil, "trailing garbage")
        check(MediaCapture.isoDate("2026-10-08") == nil, "a date alone is too little")
    }

    static func imageFiles() {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("composer-checks-\(getpid())")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let image = makeImage()
        let original = dir.appendingPathComponent("a.jpg")
        let exif: [CFString: Any] = [kCGImagePropertyExifDateTimeOriginal: "2026:10:08 07:12:30", kCGImagePropertyExifOffsetTimeOriginal: "+02:00",
                                     kCGImagePropertyExifLensModel: "secret lens"]
        write(image, to: original, type: .jpeg, properties: [kCGImagePropertyExifDictionary: exif,
                                                             kCGImagePropertyGPSDictionary: [kCGImagePropertyGPSLatitude: 50.45]])
        check(MediaCapture.imageDate(original, zone: utc) == sunrise, "a JPEG's DateTimeOriginal")

        // what an optimised copy keeps: the dates, nothing else
        let source = CGImageSourceCreateWithURL(original as CFURL, nil)!
        let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as! [CFString: Any]
        let kept = MediaCapture.dateProperties(props)
        check(kept[kCGImagePropertyGPSDictionary] == nil, "no location in the kept metadata")
        check((kept[kCGImagePropertyExifDictionary] as? [CFString: Any])?[kCGImagePropertyExifLensModel] == nil, "only dates of the EXIF")
        for type in [UTType.heic, UTType.jpeg] {
            let copy = dir.appendingPathComponent("b.\(type.preferredFilenameExtension ?? "img")")
            write(image, to: copy, type: type, properties: kept)
            check(MediaCapture.imageDate(copy, zone: kyiv) == sunrise, "an optimised \(type.preferredFilenameExtension ?? "") keeps its moment")
        }

        let digitized = dir.appendingPathComponent("c.jpg")
        write(image, to: digitized, type: .jpeg, properties: [kCGImagePropertyExifDictionary: [kCGImagePropertyExifDateTimeDigitized: "2026:10:08 05:12:30"]])
        check(MediaCapture.imageDate(digitized, zone: utc) == sunrise, "DateTimeDigitized when there is no original")
        let bare = dir.appendingPathComponent("d.jpg")
        write(image, to: bare, type: .jpeg, properties: [:])
        check(MediaCapture.imageDate(bare, zone: utc) == nil, "a photo without dates has none")
        check(MediaCapture.imageDate(dir.appendingPathComponent("missing.jpg"), zone: utc) == nil, "a missing file has none")
    }

    static func movieFiles() async {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("composer-movies-\(getpid())")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let dated = dir.appendingPathComponent("a.mov")
        let undated = dir.appendingPathComponent("b.mov")
        do {
            try await writeMovie(dated, creationDate: "2026-10-08T09:35:00+0300")
            try await writeMovie(undated, creationDate: nil)
        } catch {
            check(false, "could not write test movies: \(error)")
            return
        }
        let t = await MediaCapture.movieDate(dated)
        check(t == 1_791_441_300, "a movie's QuickTime creation date: \(String(describing: t))")
        // without a QuickTime date, the movie header's creation time (a camera writes it as it records; this writer, now)
        let header = await MediaCapture.movieDate(undated)
        check(header.map { abs($0 - Date().timeIntervalSince1970) < 600 } ?? false, "else the header's creation time: \(String(describing: header))")
        let viaDate = await MediaCapture.date(of: dated, video: true, zone: utc)
        check(viaDate == 1_791_441_300, "date(of:video:) reads movies")
    }

    static func captureOptions() {
        func blob(_ hash: String, _ role: String, name: String? = nil, poster: String? = nil) -> BlobRef {
            BlobRef(hash: hash, type: "x", size: 1, role: role, name: name, poster: poster)
        }
        let blobs = [blob("v", "video", poster: "p"), blob("p", "poster"), blob("a", "photo"), blob("b", "photo"),
                     blob("n", "audio"), blob("f", "audio", name: "song.m4a"), blob("old", "photo"), blob("c", "photo")]
        let captured: [String: Double] = ["v": 100, "p": 50, "a": 200, "b": 200.2, "n": 300, "f": 400, "old": -5, "c": 150]
        let options = MediaCapture.options(blobs, captured: captured, within: 0...1000)
        check(options.map(\.id) == ["v", "a", "n", "f", "c"], "in the attachments' order, posters and duplicates and the out of range left out: \(options.map(\.id))")
        check(options.map(\.kind) == [.video, .photo, .voice, .audio, .photo], "kinds: \(options.map(\.kind))")
        check(options.first?.time == 100, "the moment rides along")
        check(MediaCapture.options(blobs, captured: [:], within: 0...1000).isEmpty, "nothing captured, nothing offered")
        check(MediaCapture.Kind.photo.verb == "taken" && MediaCapture.Kind.voice.verb == "recorded", "verbs")
        check("\(MediaCapture.Kind.photo.title) · \(MediaCapture.Kind.photo.verb)" == "Photo · taken", "the label reads as designed")
    }

    // MARK: Pending media

    static func pendingProgress() {
        var video = PendingMedia(role: "video", name: nil, transfers: true)
        check(video.fraction == 0 && video.stage == .loading, "starts empty, loading")
        video.advance(.loading, 0.5)
        check(abs(video.fraction - 0.2) < 1e-9, "half the copy of a video is a fifth of the way: \(video.fraction)")
        video.advance(.loading, 0.25)
        check(abs(video.fraction - 0.2) < 1e-9, "it never goes back")
        video.advance(.converting, 0.5)
        check(abs(video.fraction - 0.675) < 1e-9, "half the conversion: \(video.fraction)")
        video.advance(.loading, 1)
        check(video.stage == .converting && abs(video.fraction - 0.675) < 1e-9, "an earlier stage's late report is ignored")
        video.advance(.saving, 1)
        check(video.fraction == 1 && video.stageTitle == "Saving", "done")

        var photo = PendingMedia(role: "photo", name: nil, transfers: true)
        photo.advance(.loading, 1)
        check(abs(photo.fraction - 0.8) < 1e-9, "a photo's copy is most of its way")
        var file = PendingMedia(role: "video", name: "a.mov", transfers: false)
        file.advance(.converting, 0.5)
        check(abs(file.fraction - 0.475) < 1e-9, "a local file's conversion takes the whole ring: \(file.fraction)")
        file.advance(.converting, .nan)
        check(abs(file.fraction - 0.475) < 1e-9, "a NaN report changes nothing")
        check(PendingMedia(role: "audio", name: nil, transfers: false).kindTitle == "Voice note"
              && PendingMedia(role: "audio", name: "a.m4a", transfers: false).kindTitle == "Audio", "audio kinds")
    }

    // MARK: Helpers

    static func makeImage() -> CGImage {
        let ctx = CGContext(data: nil, width: 64, height: 48, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        ctx.setFillColor(CGColor(red: 0.9, green: 0.5, blue: 0.2, alpha: 1))
        ctx.fill(CGRect(x: 0, y: 0, width: 64, height: 48))
        return ctx.makeImage()!
    }

    static func write(_ image: CGImage, to url: URL, type: UTType, properties: [CFString: Any]) {
        guard let destination = CGImageDestinationCreateWithURL(url as CFURL, type.identifier as CFString, 1, nil) else {
            check(false, "cannot write \(type)")
            return
        }
        CGImageDestinationAddImage(destination, image, properties as CFDictionary)
        check(CGImageDestinationFinalize(destination), "wrote \(url.lastPathComponent)")
    }

    /// A one-second movie of a few frames, with a QuickTime creation date as cameras write it.
    static func writeMovie(_ url: URL, creationDate: String?) async throws {
        let writer = try AVAssetWriter(outputURL: url, fileType: .mov)
        if let creationDate {
            let item = AVMutableMetadataItem()
            item.identifier = .quickTimeMetadataCreationDate
            item.value = creationDate as NSString
            item.dataType = kCMMetadataBaseDataType_UTF8 as String
            writer.metadata = [item]
        }
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: 64, AVVideoHeightKey: 48])
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA, kCVPixelBufferWidthKey as String: 64, kCVPixelBufferHeightKey as String: 48])
        writer.add(input)
        guard writer.startWriting() else { throw writer.error ?? CocoaError(.fileWriteUnknown) }
        writer.startSession(atSourceTime: .zero)
        for frame in 0..<5 {
            while !input.isReadyForMoreMediaData { try await Task.sleep(for: .milliseconds(5)) }
            var buffer: CVPixelBuffer?
            CVPixelBufferCreate(nil, 64, 48, kCVPixelFormatType_32BGRA, nil, &buffer)
            guard let buffer else { throw CocoaError(.fileWriteUnknown) }
            adaptor.append(buffer, withPresentationTime: CMTime(value: CMTimeValue(frame), timescale: 5))
        }
        input.markAsFinished()
        await writer.finishWriting()
        if writer.status != .completed { throw writer.error ?? CocoaError(.fileWriteUnknown) }
    }
}

/// A deterministic generator (SplitMix64) for repeatable draws.
struct SeededGenerator: RandomNumberGenerator {
    var state: UInt64
    init(seed: UInt64) { state = seed }
    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}
