// Generates ios/Fractonica/Features/Journal/Composer/EmojiData.swift: every emoji the journal offers (the emoji
// picker and the random emoji of a new entry), from Unicode's emoji-test.txt and CLDR's English annotations.
//
//   curl -sSfLo /tmp/emoji-test.txt https://www.unicode.org/Public/emoji/latest/emoji-test.txt
//   curl -sSfLo /tmp/en.xml https://raw.githubusercontent.com/unicode-org/cldr/main/common/annotations/en.xml
//   curl -sSfLo /tmp/en-derived.xml https://raw.githubusercontent.com/unicode-org/cldr/main/common/annotationsDerived/en.xml
//   swift ios/scripts/make-emoji.swift /tmp/emoji-test.txt /tmp/en.xml /tmp/en-derived.xml [AppleColorEmoji.ttc]
//
// What is in it: every fully-qualified RGI emoji (emoji-test.txt's "fully-qualified" lines; the components, the
// skin-tone and hair swatches, are left out) of Emoji 16.0 or older, the newest set iOS 18.4 and later draw (the app
// runs from iOS 18.6; Emoji 17.0 arrived with iOS 26.4). Skin-tone variants are folded into their base emoji: the
// picker shows each emoji once, in the default yellow, and a random pick does not favour people and hands five times
// over. Each emoji keeps its CLDR name, its CLDR keywords (the annotation files, optional: "coffee", "tea" for the hot
// beverage) and its Unicode group and subgroup, for the picker's sections and search.
//
// With the font of the oldest supported iOS (the iOS 18.6 simulator runtime's
// …/RuntimeRoot/System/Library/Fonts/CoreAddition/AppleColorEmoji-160px.ttc, found by itself when that runtime is
// installed), every emoji is also shaped with CoreText and kept only when that font draws it as one glyph.
import CoreText
import Foundation

let args = CommandLine.arguments
guard args.count >= 2, let text = try? String(contentsOfFile: args[1], encoding: .utf8) else {
    FileHandle.standardError.write(Data("usage: swift make-emoji.swift emoji-test.txt [annotations.xml…] [AppleColorEmoji.ttc]\n".utf8))
    exit(2)
}
let annotationFiles = args.dropFirst(2).filter { $0.hasSuffix(".xml") }
let fontArgument = args.dropFirst(2).first { !$0.hasSuffix(".xml") }

/// An emoji without its presentation selectors, as CLDR's annotations name it.
func bare(_ s: String) -> String { String(String.UnicodeScalarView(s.unicodeScalars.filter { $0.value != 0xFE0F })) }

/// CLDR keywords by bare emoji: "☕" → ["beverage", "cafe", "coffee", …].
var keywords: [String: [String]] = [:]
for file in annotationFiles {
    guard let xml = try? String(contentsOfFile: file, encoding: .utf8) else {
        FileHandle.standardError.write(Data("cannot read \(file)\n".utf8))
        exit(1)
    }
    let pattern = try! NSRegularExpression(pattern: #"<annotation cp="([^"]+)">([^<]*)</annotation>"#)
    for match in pattern.matches(in: xml, range: NSRange(xml.startIndex..., in: xml)) {
        let cp = String(xml[Range(match.range(at: 1), in: xml)!])
        let words = String(xml[Range(match.range(at: 2), in: xml)!])
            .replacingOccurrences(of: "&amp;", with: "&").replacingOccurrences(of: "&quot;", with: "\"")
            .replacingOccurrences(of: "&apos;", with: "'").replacingOccurrences(of: "&lt;", with: "<").replacingOccurrences(of: "&gt;", with: ">")
            .split(separator: "|").map { $0.trimmingCharacters(in: .whitespaces).lowercased() }.filter { !$0.isEmpty }
        keywords[bare(cp), default: []].append(contentsOf: words)
    }
}
let maxVersion = 16.0
let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
let output = root.appendingPathComponent("Fractonica/Features/Journal/Composer/EmojiData.swift")

// The font of the oldest supported system, when there is one.
func defaultFont() -> String? {
    let volumes = "/Library/Developer/CoreSimulator/Volumes"
    let names = (try? FileManager.default.contentsOfDirectory(atPath: volumes)) ?? []
    for name in names where name.hasPrefix("iOS_22G") {   // iOS 18.6 (22G86)
        let path = "\(volumes)/\(name)/Library/Developer/CoreSimulator/Profiles/Runtimes/iOS 18.6.simruntime/Contents/Resources/RuntimeRoot/System/Library/Fonts/CoreAddition/AppleColorEmoji-160px.ttc"
        if FileManager.default.fileExists(atPath: path) { return path }
    }
    return nil
}
let fontPath = fontArgument ?? defaultFont()

/// Whether the font at `url` draws `emoji` as a single glyph (no fallback to another font, no left-over pieces).
func draws(_ emoji: String, font: CTFont, url: URL) -> Bool {
    let attributed = NSAttributedString(string: emoji, attributes: [NSAttributedString.Key(kCTFontAttributeName as String): font])
    let line = CTLineCreateWithAttributedString(attributed)
    let runs = CTLineGetGlyphRuns(line) as! [CTRun]
    guard runs.count == 1, let run = runs.first else { return false }
    let attributes = CTRunGetAttributes(run) as NSDictionary
    let runFont = attributes[kCTFontAttributeName as String] as! CTFont
    guard let runURL = CTFontCopyAttribute(runFont, kCTFontURLAttribute) as? URL, runURL.standardizedFileURL == url.standardizedFileURL else { return false }
    let count = CTRunGetGlyphCount(run)
    var glyphs = [CGGlyph](repeating: 0, count: count)
    CTRunGetGlyphs(run, CFRange(location: 0, length: count), &glyphs)
    var advances = [CGSize](repeating: .zero, count: count)
    CTRunGetAdvances(run, CFRange(location: 0, length: count), &advances)
    let visible = zip(glyphs, advances).filter { $0.1.width > 0 }
    return visible.count == 1 && visible[0].0 != 0
}

var checker: ((String) -> Bool)?
if let fontPath {
    let url = URL(fileURLWithPath: fontPath)
    guard let descriptors = CTFontManagerCreateFontDescriptorsFromURL(url as CFURL) as? [CTFontDescriptor], let first = descriptors.first else {
        FileHandle.standardError.write(Data("cannot read \(fontPath)\n".utf8))
        exit(1)
    }
    let font = CTFontCreateWithFontDescriptor(first, 40, nil)
    checker = { draws($0, font: font, url: url) }
    print("checking against \(fontPath)")
} else {
    print("note: no iOS 18.6 emoji font found; the emoji are not checked against it")
}

struct Group { var title: String; var lines: [String] = [] }
var groups: [Group] = []
var subgroup = ""
var counts = (kept: 0, newer: 0, tones: 0, undrawn: 0)
var undrawn: [String] = []
let tones: ClosedRange<UInt32> = 0x1F3FB...0x1F3FF
var sourceVersion = ""

for raw in text.split(separator: "\n", omittingEmptySubsequences: false) {
    let line = String(raw)
    if line.hasPrefix("# Version:") { sourceVersion = line.replacingOccurrences(of: "# Version:", with: "").trimmingCharacters(in: .whitespaces) }
    if line.hasPrefix("# group: ") {
        let title = String(line.dropFirst("# group: ".count))
        groups.append(Group(title: title))
        continue
    }
    if line.hasPrefix("# subgroup: ") {
        subgroup = String(line.dropFirst("# subgroup: ".count))
        groups[groups.count - 1].lines.append("@" + subgroup)
        continue
    }
    guard !line.hasPrefix("#"), let semi = line.firstIndex(of: ";"), let hash = line.firstIndex(of: "#") else { continue }
    let status = line[line.index(after: semi)..<hash].trimmingCharacters(in: .whitespaces)
    guard status == "fully-qualified" else { continue }
    let scalars = line[..<semi].split(separator: " ").compactMap { UInt32($0, radix: 16) }
    let comment = line[line.index(after: hash)...].trimmingCharacters(in: .whitespaces)
    // "😀 E1.0 grinning face"
    let parts = comment.split(separator: " ", maxSplits: 2).map(String.init)
    guard parts.count == 3, parts[1].hasPrefix("E"), let version = Double(parts[1].dropFirst()) else { continue }
    if version > maxVersion { counts.newer += 1; continue }
    if scalars.contains(where: tones.contains) { counts.tones += 1; continue }
    let emoji = String(String.UnicodeScalarView(scalars.compactMap(Unicode.Scalar.init)))
    if let checker, !checker(emoji) { counts.undrawn += 1; undrawn.append("\(emoji) \(parts[2])"); continue }
    counts.kept += 1
    // the keywords the name does not already say, once each
    let nameWords = Set(parts[2].lowercased().split(whereSeparator: { !$0.isLetter && !$0.isNumber }).map(String.init))
    var extra: [String] = []
    for word in keywords[bare(emoji)] ?? [] where !nameWords.contains(word) && !extra.contains(word) && !parts[2].lowercased().contains(word) {
        extra.append(word)
    }
    groups[groups.count - 1].lines.append("\(emoji)\t\(parts[2])" + (extra.isEmpty ? "" : "\t" + extra.joined(separator: " | ")))
}

groups.removeAll { $0.title == "Component" }
for i in groups.indices {
    // a subgroup left empty (all of it newer, or tones) goes
    var lines: [String] = []
    for line in groups[i].lines {
        if line.hasPrefix("@"), let last = lines.last, last.hasPrefix("@") { lines.removeLast() }
        lines.append(line)
    }
    if let last = lines.last, last.hasPrefix("@") { lines.removeLast() }
    groups[i].lines = lines
}

var body = ""
for group in groups where !group.lines.isEmpty {
    body += "#\(group.title)\n" + group.lines.joined(separator: "\n") + "\n"
}

let file = """
// Generated by ios/scripts/make-emoji.swift from Unicode's emoji-test.txt (version \(sourceVersion)). Do not edit.
//
// Every fully-qualified RGI emoji of Emoji \(maxVersion) or older, what iOS 18.4 and later draw\(checker == nil ? "" : " (each checked\n// against iOS 18.6's emoji font)"), with skin-tone variants folded into their base emoji: \(counts.kept) emoji. One line
// per emoji, "emoji<TAB>CLDR name[<TAB>CLDR keywords | …]", in CLDR order; "#Group" and "@subgroup" lines head their
// emoji.

enum EmojiData {
    /// The newest Emoji version included.
    static let version = "\(maxVersion)"
    /// How many emoji the table holds.
    static let count = \(counts.kept)

    static let table = #\"\"\"
\(body)\"\"\"#
}

"""
try file.write(to: output, atomically: true, encoding: .utf8)
print("kept \(counts.kept); left out \(counts.newer) newer than Emoji \(maxVersion), \(counts.tones) skin-tone variants, \(counts.undrawn) not drawn by the font")
for item in undrawn.prefix(40) { print("  not drawn: \(item)") }
print("wrote \(output.path)")
