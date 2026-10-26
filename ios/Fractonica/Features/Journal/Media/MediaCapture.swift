@preconcurrency import AVFoundation
import Foundation
import ImageIO

/// When an attachment was captured, for the moment picker's "use the media's time": a photo's EXIF DateTimeOriginal
/// (HEIC and JPEG alike, with its OffsetTimeOriginal when the camera wrote one, else read in the entry's zone), a
/// video's QuickTime creation date, a voice note's recording start (the composer notes that one itself). Read from the
/// file as it was picked, before the journal optimises it (which keeps the dates, see `JournalMedia`).
enum MediaCapture {
    // MARK: Reading files

    /// The capture moment of an image or a movie file (by its type), nil when it does not say.
    static func date(of url: URL, video: Bool, zone: TimeZone) async -> Double? {
        if video { return await movieDate(url) }
        return await Task.detached(priority: .utility) { imageDate(url, zone: zone) }.value
    }

    /// A photo's moment: EXIF DateTimeOriginal (then DateTimeDigitized, then TIFF DateTime), with its offset.
    static func imageDate(_ url: URL, zone: TimeZone) -> Double? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
              let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] else { return nil }
        return imageDate(props, zone: zone)
    }

    /// The same from an image's properties (`CGImageSourceCopyPropertiesAtIndex`).
    static func imageDate(_ props: [CFString: Any], zone: TimeZone) -> Double? {
        let exif = props[kCGImagePropertyExifDictionary] as? [CFString: Any] ?? [:]
        let tiff = props[kCGImagePropertyTIFFDictionary] as? [CFString: Any] ?? [:]
        let candidates: [(String?, String?, String?)] = [
            (exif[kCGImagePropertyExifDateTimeOriginal] as? String, exif[kCGImagePropertyExifOffsetTimeOriginal] as? String,
             exif[kCGImagePropertyExifSubsecTimeOriginal] as? String),
            (exif[kCGImagePropertyExifDateTimeDigitized] as? String, exif[kCGImagePropertyExifOffsetTimeDigitized] as? String,
             exif[kCGImagePropertyExifSubsecTimeDigitized] as? String),
            (tiff[kCGImagePropertyTIFFDateTime] as? String, exif[kCGImagePropertyExifOffsetTime] as? String, nil),
        ]
        for (date, offset, subsec) in candidates {
            if let date, let t = exifDate(date, offset: offset, subsec: subsec, zone: zone) { return t }
        }
        return nil
    }

    /// A movie's creation date (QuickTime `com.apple.quicktime.creationdate`, else the common creation date).
    static func movieDate(_ url: URL) async -> Double? {
        let asset = AVURLAsset(url: url)
        if let items = try? await asset.load(.metadata) {
            for item in items where item.identifier == .quickTimeMetadataCreationDate || item.commonKey == .commonKeyCreationDate {
                if let date = try? await item.load(.dateValue) { return date.timeIntervalSince1970 }
                if let text = try? await item.load(.stringValue), let t = isoDate(text) { return t }
            }
        }
        if let item = try? await asset.load(.creationDate) {
            if let date = try? await item.load(.dateValue) { return date.timeIntervalSince1970 }
            if let text = try? await item.load(.stringValue), let t = isoDate(text) { return t }
        }
        return nil
    }

    /// The date properties of an image, to write into an optimised copy so it keeps its moment.
    static func dateProperties(_ props: [CFString: Any]) -> [CFString: Any] {
        var out: [CFString: Any] = [:]
        if let exif = props[kCGImagePropertyExifDictionary] as? [CFString: Any] {
            let keys = [kCGImagePropertyExifDateTimeOriginal, kCGImagePropertyExifOffsetTimeOriginal, kCGImagePropertyExifSubsecTimeOriginal,
                        kCGImagePropertyExifDateTimeDigitized, kCGImagePropertyExifOffsetTimeDigitized, kCGImagePropertyExifSubsecTimeDigitized,
                        kCGImagePropertyExifOffsetTime]
            let kept = exif.filter { keys.contains($0.key) }
            if !kept.isEmpty { out[kCGImagePropertyExifDictionary] = kept }
        }
        if let tiff = props[kCGImagePropertyTIFFDictionary] as? [CFString: Any], let date = tiff[kCGImagePropertyTIFFDateTime] {
            out[kCGImagePropertyTIFFDictionary] = [kCGImagePropertyTIFFDateTime: date]
        }
        return out
    }

    // MARK: Parsing

    /// "2024:05:01 14:35:12" (EXIF) with an optional offset ("+02:00", "-0500", "Z") and fraction ("123"); without an
    /// offset, the time is read in `zone` (the camera's local time, which the entry's zone is the best guess of).
    static func exifDate(_ text: String, offset: String?, subsec: String?, zone: TimeZone) -> Double? {
        let digits = text.trimmingCharacters(in: .whitespacesAndNewlines.union(.controlCharacters))
        let parts = digits.split(whereSeparator: { $0 == ":" || $0 == " " || $0 == "-" || $0 == "T" }).compactMap { Int($0) }
        guard parts.count >= 6, parts[0] > 1800, (1...12).contains(parts[1]), (1...31).contains(parts[2]),
              (0...23).contains(parts[3]), (0...59).contains(parts[4]), (0...60).contains(parts[5]) else { return nil }
        var components = DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: parts[3], minute: parts[4], second: parts[5])
        var calendar = Calendar(identifier: .gregorian)
        if let offset, let seconds = offsetSeconds(offset), let fixed = TimeZone(secondsFromGMT: seconds) {
            calendar.timeZone = fixed
        } else {
            calendar.timeZone = zone
        }
        components.timeZone = calendar.timeZone
        guard let date = calendar.date(from: components) else { return nil }
        var t = date.timeIntervalSince1970
        if let subsec, let digits = Int(subsec.trimmingCharacters(in: .whitespaces)), subsec.count <= 9 {
            t += Double(digits) / pow(10, Double(subsec.trimmingCharacters(in: .whitespaces).count))
        }
        return t
    }

    /// "+02:00" → 7200, "-0530" → −19800, "Z" → 0.
    static func offsetSeconds(_ text: String) -> Int? {
        let s = text.trimmingCharacters(in: .whitespaces)
        if s == "Z" || s == "z" { return 0 }
        guard let sign = s.first, sign == "+" || sign == "-" else { return nil }
        let digits = s.dropFirst().filter(\.isNumber)
        guard digits.count == 4 || digits.count == 2, let n = Int(digits) else { return nil }
        let (h, m) = digits.count == 4 ? (n / 100, n % 100) : (n, 0)
        guard h <= 14, m < 60 else { return nil }
        return (sign == "-" ? -1 : 1) * (h * 3600 + m * 60)
    }

    /// ISO 8601 as QuickTime writes it: "2024-05-01T14:35:12+0200", "…+02:00", "…Z", with or without a fraction.
    static func isoDate(_ text: String) -> Double? {
        let s = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard s.count >= 19 else { return nil }
        let head = String(s.prefix(19))
        var rest = s.dropFirst(19)
        var fraction = 0.0
        if rest.first == "." {
            let digits = rest.dropFirst().prefix(while: \.isNumber)
            fraction = Double("0." + digits) ?? 0
            rest = rest.dropFirst(1 + digits.count)
        }
        let offset = rest.isEmpty ? nil : String(rest)
        if let offset, offsetSeconds(offset) == nil { return nil }
        // without an offset, QuickTime means UTC
        guard let t = exifDate(head, offset: offset ?? "Z", subsec: nil, zone: TimeZone(secondsFromGMT: 0)!) else { return nil }
        return t + fraction
    }

    // MARK: Choices

    /// One way to take an attachment's time in the moment picker.
    struct Option: Identifiable, Hashable, Sendable {
        /// The attachment's blob hash.
        let id: String
        let kind: Kind
        let time: Double
    }

    enum Kind: String, Sendable {
        case photo, video, voice, audio

        /// "Photo", "Video", "Voice note", "Audio".
        var title: String {
            switch self {
            case .photo: "Photo"
            case .video: "Video"
            case .voice: "Voice note"
            case .audio: "Audio"
            }
        }

        /// "taken", "recorded".
        var verb: String { self == .photo ? "taken" : "recorded" }

        var systemImage: String {
            switch self {
            case .photo: "photo"
            case .video: "video"
            case .voice: "mic"
            case .audio: "waveform"
            }
        }
    }

    /// The attachments' capture moments the picker offers, in the attachments' order: one per attachment that has one,
    /// within the catalogue, the same moment (to the second) offered once.
    static func options(_ blobs: [BlobRef], captured: [String: Double], within range: ClosedRange<Double>) -> [Option] {
        var seen = Set<Int>()
        var out: [Option] = []
        for blob in blobs where blob.role != "poster" {
            guard let t = captured[blob.hash], range.contains(t), seen.insert(Int(t.rounded())).inserted else { continue }
            let kind: Kind = switch blob.role {
            case "video": .video
            case "audio": blob.name == nil ? .voice : .audio
            default: .photo
            }
            out.append(Option(id: blob.hash, kind: kind, time: t))
        }
        return out
    }
}
