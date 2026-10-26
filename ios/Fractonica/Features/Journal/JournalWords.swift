import FractonicaKit
import Foundation

/// "Thu 8 Oct 2026 · 14:23": an entry's Earth moment, short (empty in pure mode).
func earthMoment(_ t: Double, words: Wording) -> String {
    guard !words.pure else { return "" }
    let p = words.earth.parts(t)
    return "\(EarthTime.weekdaysShort[p.weekday]) \(p.day) \(EarthTime.monthsShort[p.month - 1]) \(p.year) · \(words.earth.time(t, seconds: false))"
}

/// "1.4 MB": a byte count for storage figures.
func byteCount(_ bytes: Int64) -> String {
    ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)
}
