import FractonicaKit
import Foundation

/// Everything the Sound screen says, in Earth terms or in pure mode (src/audio/format.js and src/audio/words.js, revision
/// 3 of docs/design/70-sound.md). Pure mode keeps the same panel and the same audio but says it in Fractonica terms only:
/// pitch as a folded ratio with a slash, an octave offset and cents, absolute pitch in pB (cycles per Blink); cycle
/// lengths on the unit ladder ("1η", "11η"); real-time spans in Blinks; speeds as units per Blink; loudness and
/// percentages as glyph pairs (drawn by the views). Never Hz, a note name, seconds, BPM, a percentage or a date.
struct SoundWords: Sendable {
    let pure: Bool
    let wording: Wording
    var notation: Notation { wording.notation }

    init(pure: Bool, wording: Wording) {
        self.pure = pure
        self.wording = wording
    }

    init(_ wording: Wording) {
        self.init(pure: wording.pure, wording: wording)
    }

    // MARK: Numbers (format.js)

    /// "4.5" for 4.50, "2" for 2.00: a fixed-point string without trailing zeros.
    static func trim(_ s: String) -> String {
        guard s.contains(".") else { return s }
        var t = s
        while t.hasSuffix("0") { t.removeLast() }
        if t.hasSuffix(".") { t.removeLast() }
        return t
    }

    /// `v` with `digits` decimals, rounded like JavaScript's `toFixed`: an exact tie goes away from zero ("0.13" for
    /// 0.125, "63" for 62.5), where printf would round it to even.
    static func fixed(_ v: Double, _ digits: Int) -> String {
        let text = String(format: "%.\(digits)f", v)
        guard v.isFinite else { return text }
        // printf writes the exact binary value: a tie is a 5 followed only by zeros after the kept digits
        let exact = String(format: "%.\(digits + 40)f", abs(v))
        guard let point = exact.firstIndex(of: ".") else { return text }
        let rest = exact[exact.index(point, offsetBy: digits + 1)...]
        guard rest.first == "5", rest.dropFirst().allSatisfy({ $0 == "0" }) else { return text }
        let scale = pow(10, Double(digits))
        let away = (abs(v) * scale).rounded(.up) / scale
        return (v < 0 ? "-" : "") + String(format: "%.\(digits)f", away)
    }

    /// `v` rounded to `digits` significant digits (JavaScript's `toPrecision` as a number).
    static func precision(_ v: Double, _ digits: Int) -> Double {
        guard v != 0, v.isFinite else { return v }
        let e = Int(log10(abs(v)).rounded(.down))
        let scale = pow(10, Double(digits - 1 - e))
        return (v * scale).rounded() / scale
    }

    /// A plain decimal of at most `digits` significant digits, never in exponent notation: 34.2, 0.364, 1235.
    static func plain(_ v: Double, _ digits: Int = 3) -> String {
        guard v != 0 else { return "0" }
        let n = precision(v, digits)
        let decimals = max(0, digits - 1 - Int(log10(abs(n)).rounded(.down)))
        return trim(fixed(n, min(12, decimals)))
    }

    /// 4547 → "4,547" (the header's grouping).
    static func int(_ v: Double) -> String {
        let n = Int(v.rounded())
        let digits = String(abs(n))
        var out = ""
        for (i, ch) in digits.enumerated() {
            if i > 0 && (digits.count - i) % 3 == 0 { out.append(",") }
            out.append(ch)
        }
        return (n < 0 ? "−" : "") + out
    }

    /// A frequency in the unit that reads best: "2.23 kHz", "349.1 Hz", "22.51 Hz", "643 mHz", "4.39 nHz".
    static func hz(_ hz: Double) -> String {
        guard hz > 0, hz.isFinite else { return "—" }
        if hz >= 999.95 { return "\(fixed(hz / 1000, hz >= 9995 ? 1 : 2)) kHz" }
        if hz >= 99.995 { return "\(fixed(hz, 1)) Hz" }
        if hz >= 0.9995 { return "\(fixed(hz, 2)) Hz" }
        for (k, unit) in [(1e3, "mHz"), (1e6, "µHz"), (1e9, "nHz")] {
            let v = hz * k
            if v >= 0.9995 || unit == "nHz" { return "\(plain(v, 3)) \(unit)" }
        }
        return "—"
    }

    /// A time-lapse rate: "×1", "×4,547", "×2.63 M", "−×60"; "paused" for 0.
    static func rate(_ rate: Double) -> String {
        if rate == 0 { return "paused" }
        let a = abs(rate)
        let body: String
        if a >= 9.995e8 {
            body = "\(fixed(a / 1e9, a >= 9.995e9 ? 1 : 2)) G"
        } else if a >= 1e6 {
            body = "\(fixed(a / 1e6, a >= 9.995e6 ? 1 : 2)) M"
        } else if a >= 100 {
            body = int(a)
        } else if a >= 10 {
            body = fixed(a, 0)
        } else if a >= 1 {
            body = trim(fixed(a, 1))
        } else {
            body = trim(fixed(a, min(12, 1 - Int(log10(a).rounded(.down)))))
        }
        return "\(rate < 0 ? "−" : "")×\(body)"
    }

    /// The length of a cycle in the one unit that fits: "72.1 y", "16.2 d", "33.7 min", "311 ms".
    static func period(_ s: Double) -> String {
        guard s > 0, s.isFinite else { return "—" }
        func three(_ v: Double, _ unit: String) -> String { "\(plain(v, 3)) \(unit)" }
        if s < 0.9995 { return "\(Int((s * 1000).rounded())) ms" }
        if s < 60 { return three(s, "s") }
        if s < 3600 { return three(s / 60, "min") }
        if s < 86400 { return three(s / 3600, "h") }
        if s < 31_557_600 { return three(s / 86400, "d") }
        return three(s / 31_557_600, "y")
    }

    /// Real seconds: "4.00 s", "0.44 s", "120 ms", "2.0 min".
    static func seconds(_ s: Double) -> String {
        guard s.isFinite else { return "—" }
        if s < 0.1 { return "\(fixed(s * 1000, s < 0.01 ? 1 : 0)) ms" }
        if s < 10 { return "\(fixed(s, 2)) s" }
        if s < 100 { return "\(fixed(s, 1)) s" }
        if s < 3600 { return "\(fixed(s / 60, 1)) min" }
        return "\(fixed(s / 3600, 1)) h"
    }

    /// "4 s", "0.5 s", "10 s", "2 min".
    static func secondsShort(_ s: Double) -> String {
        let text = seconds(s)
        guard let space = text.firstIndex(of: " ") else { return text }
        return trim(String(text[..<space])) + text[space...]
    }

    /// "−18 dB" with a true minus sign.
    static func db(_ db: Double) -> String {
        let r = Int(db.rounded())
        return "\(r < 0 ? "−" : r > 0 ? "+" : "")\(abs(r)) dB"
    }

    // MARK: Pure numbers (words.js)

    /// "×1", "×2", "×½", "×1.5", "×0.749".
    static func ratioFactor(_ r: Double) -> String {
        if abs(r - 0.5) < 1e-9 { return "×½" }
        if abs(r - 0.25) < 1e-9 { return "×¼" }
        return "×\(plain(r))"
    }

    private static func sign(_ n: Int) -> String { n < 0 ? "−" : "+" }

    /// "octave +1".
    static func octaveOffset(_ n: Int) -> String { "octave \(n == 0 ? "+0" : sign(n) + String(abs(n)))" }

    /// "801¢".
    static func cents(_ c: Double) -> String { "\(Int(c.rounded()))¢" }

    /// 6231 → "6 231" with a narrow no-break space (a digit group never reads as a year).
    static func groupNarrow(_ v: Double) -> String {
        let digits = String(Int(v.rounded()))
        var out = ""
        for (i, ch) in digits.enumerated() {
            if i > 0 && (digits.count - i) % 3 == 0 { out.append("\u{202F}") }
            out.append(ch)
        }
        return out
    }

    /// A count: "0.364", "4", "12.5", "1 235", "2.63 M", "1.82 G".
    static func count(_ v: Double) -> String {
        guard v.isFinite else { return "—" }
        if v >= 9.995e8 { return "\(fixed(v / 1e9, v >= 9.995e9 ? 1 : 2)) G" }
        if v >= 9.995e5 { return "\(fixed(v / 1e6, v >= 9.995e6 ? 1 : 2)) M" }
        if v >= 999.5 { return groupNarrow(v) }
        return plain(v)
    }

    /// "4 Blinks", "1 Blink", "0.364 Blinks", "2.63 M Blinks".
    static func blinks(_ b: Double) -> String {
        guard b.isFinite else { return "—" }
        if b > 0 && b < 0.001 { return "<0.001 \(Notation.blink)s" }
        let n = count(b)
        return "\(n) \(Notation.blink)\(n == "1" ? "" : "s")"
    }

    // MARK: Pitch

    /// The ratio of a voice: "1625:1024" · pure "1625/1024" (a colon would read as a time of day).
    func ratio(_ row: SoundTuning.Row) -> String { pure ? row.slashText : row.ratioText }

    /// An absolute pitch: "349.1 Hz" · pure "108.5 pB".
    func pitch(_ hz: Double) -> String {
        pure ? pb(hz) : Self.hz(hz)
    }

    /// Cycles per Blink of a frequency: 110 Hz → "34.2 pB".
    func pb(_ hz: Double) -> String {
        hz > 0 && hz.isFinite ? Notation.pbText(notation.perBlink(hz)) : "—"
    }

    /// The second line of a mixer strip: "349.1 Hz · F4 −1¢ · 16.2 d" · pure "108.5 pB · octave +1 · 799¢ · 1ε".
    func voiceLine(_ row: SoundTuning.Row, baseHz: Double) -> String {
        let hz = SoundTuning.frequency(row, baseHz: baseHz)
        if pure {
            return [pb(hz), Self.octaveOffset(row.octave), Self.cents(row.pcCents), cycleLength(row.level)].joined(separator: " · ")
        }
        return [Self.hz(hz), SoundTuning.noteLabel(hz), cycleLength(row.level)].joined(separator: " · ")
    }

    /// One cycle of a level: "16.2 d" · pure "1ε", "11η".
    func cycleLength(_ level: Int) -> String {
        pure ? notation.cycleLength(level: level) : Self.period(FractonicaClock.shared.levelInfo(level).meanSeconds)
    }

    /// The base pitch: "110 Hz · A2" · pure ("ground ×1", "34.2 pB").
    func ground(_ semitones: Int) -> (head: String, sub: String) {
        let hz = SoundTuning.baseHz(semitones: semitones)
        if pure {
            let factor = Self.ratioFactor(pow(2, Double(semitones) / 12))
            let head: String
            if semitones == 0 {
                head = "ground \(factor)"
            } else if abs(semitones) == 12 {
                head = "\(Self.sign(semitones))1 octave \(factor)"
            } else {
                head = "\(Self.sign(semitones))\(abs(semitones) * 100)¢ \(factor)"
            }
            return (head, pb(hz))
        }
        return ("\(Self.fixed(hz, hz < 100 ? 1 : 0)) Hz", SoundTuning.note(of: hz).name)
    }

    /// The physical register's transposition: "−1 oct" · pure "−1 octave", "no shift".
    func octaveShift(_ n: Int) -> String {
        if pure {
            if n == 0 { return "no shift" }
            return "\(Self.sign(n))\(abs(n)) octave\(abs(n) == 1 ? "" : "s")"
        }
        return "\(n < 0 ? "−" : n > 0 ? "+" : "")\(abs(n)) oct"
    }

    /// What sounds in the physical register: "ο 123.8 Hz · π 1.11 kHz · ρ 4.46 kHz".
    func physicalList(_ shift: Int) -> String {
        let audible = SoundTuning.physicalLevels(shift: shift)
        guard !audible.isEmpty else { return "No cycle falls into the audible band at this transposition." }
        return audible.map { "\($0.letter) \(pitch($0.hz))" }.joined(separator: "  ·  ")
    }

    /// The true rates of the deepest cycles: "ξ 22.5 Hz, ο 247.7 Hz, π 2.23 kHz, ρ 8.92 kHz" · pure "ξ 7 pB, ο 77 pB …".
    var deepRates: String {
        SoundTuning.deepRates().map { "\($0.letter) \(pitch($0.hz))" }.joined(separator: ", ")
    }

    // MARK: Real-time spans

    /// A span of real seconds: "4.00 s" · pure "12.9 Blinks".
    func span(_ seconds: Double) -> String {
        pure ? Self.blinks(notation.secondsToBlinks(seconds)) : Self.seconds(seconds)
    }

    /// A chime floor option: "0.5 s · default" · pure "1.61 Blinks · default".
    func floorOption(_ seconds: Double, name: String?) -> String {
        let value = pure ? Self.blinks(notation.secondsToBlinks(seconds)) : "\(Self.trim(String(seconds))) s"
        return name.map { "\(value) · \($0)" } ?? value
    }

    /// The pure-mode default of the tempo lock: the stored 4 s shows as the clean 12 Blinks (one η in 12 Blinks is
    /// exactly "3ι per Blink").
    static let tempoDefaultBlinks = 12.0

    /// The tempo lock's length as the stepper shows it: seconds, or Blinks in pure mode (3 digits; the untouched
    /// default is 12).
    func tempoValue(_ seconds: Double) -> Double {
        guard pure else { return seconds }
        if abs(seconds - SoundPreferences().tempoSeconds) < 1e-9 { return Self.tempoDefaultBlinks }
        return Self.precision(notation.secondsToBlinks(seconds), 3)
    }

    /// The stored seconds of a stepper value.
    func tempoSeconds(_ value: Double) -> Double { pure ? notation.blinksToSeconds(value) : value }

    /// "4 s" · pure "12 Blinks".
    func tempoText(_ value: Double) -> String {
        pure ? Self.blinks(value) : Self.secondsShort(value)
    }

    /// The stepper's ladder: whole, musical lengths (pure: the clean locks of the design — 7, 9, 11, 12, 36 Blinks).
    var tempoLadder: [Double] {
        pure
            ? [1, 2, 3, 4, 6, 7, 9, 11, 12, 16, 24, 36, 48, 72, 108, 144, 288, 576, 1152, 1930]
            : [0.25, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 30, 45, 60, 90, 120, 180, 300, 450, 600]
    }

    // MARK: Depths

    /// A depth in the tempo lock's list: "η 7 · ≈ 5 h 3 min" · pure "η 7 · Helion", "ζ 6 · 11η".
    func depthOption(_ level: Int) -> String { wording.levelLabel(level) }

    /// What a depth is, for the voice details (pure): "Delta, a major period", "Helion, a minor unit", "between two
    /// units", "finer than a Blink".
    func depthKind(_ level: Int) -> String {
        switch Notation.levelKind(level) {
        case "major": "\(Notation.unitName(level: level)), a major period"
        case "unit": "\(Notation.unitName(level: level)), a minor unit"
        case "between": "between two units"
        default: "finer than a \(Notation.blink)"
        }
    }

    // MARK: Speeds

    /// A speed chip: the words and a smaller unit line.
    struct SpeedChip: Identifiable, Hashable, Sendable {
        enum Action: Hashable, Sendable { case live, rate(Double), pause, reverse }
        let id: String
        let label: String
        let unit: String
        let help: String
        let action: Action
    }

    /// The speeds offered under the tempo lock: Live, real time, five time-lapses, Pause, Reverse.
    var speedChips: [SpeedChip] {
        let live = SpeedChip(id: "live", label: "Live", unit: pure ? "follow now" : "device clock", help: "Jump to the present moment and follow it", action: .live)
        let pause = SpeedChip(id: "pause", label: "Pause", unit: "", help: "Stop the clock: the drone holds, the bells wait", action: .pause)
        let reverse = SpeedChip(id: "reverse", label: "Reverse", unit: "", help: "Run time backwards at the same speed: the bells play in reverse order", action: .reverse)
        if pure {
            let tail = " per \(Notation.blink)"
            let real = SpeedChip(id: "real", label: notation.rateLabel(1), unit: "", help: "Real time from the moment shown now", action: .rate(1))
            let units = ["lambda", "iota", "eta", "epsilon", "delta"].compactMap { id -> SpeedChip? in
                guard let r = notation.rates.first(where: { $0.id == id }) else { return nil }
                let label = r.label.hasSuffix(tail) ? String(r.label.dropLast(tail.count)) : r.label
                return SpeedChip(id: id, label: label, unit: tail.trimmingCharacters(in: .whitespaces), help: rateTip(r.rate), action: .rate(r.rate))
            }
            return [live, real] + units + [pause, reverse]
        }
        let presets: [(Double, String, String)] = [
            (1, "real time", "Real time from the time shown now"),
            (60, "1 min/s", "One minute of clock time per second"),
            (3600, "1 h/s", "One hour of clock time per second"),
            (86400, "1 d/s", "One day of clock time per second"),
            (2_629_800, "1 mo/s", "One month of clock time per second"),
        ]
        return [live] + presets.map { SpeedChip(id: "x\($0.0)", label: Self.rate($0.0), unit: $0.1, help: $0.2, action: .rate($0.0)) } + [pause, reverse]
    }

    private static let numberWords = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
                                      "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen",
                                      "Nineteen", "Twenty"]

    /// A speed in prose with the unit's name: "One Helion passes every Blink", "Four Preons pass every Blink".
    func rateTip(_ rate: Double) -> String {
        let say = notation.rateLabel(abs(rate))
        if say == notation.rates.first?.label { return "Real time: one \(Notation.blink) passes every \(Notation.blink)" }
        let tail = " per \(Notation.blink)"
        guard say.hasSuffix(tail) else { return say }
        let head = String(say.dropLast(tail.count))
        let digits = head.prefix { $0.isNumber || $0 == "." }
        let symbol = String(head.dropFirst(digits.count))
        guard let unit = Notation.unit(symbol) else { return say }
        let n = digits.isEmpty ? 1 : Double(digits) ?? 1
        let countWord = n == n.rounded() && Int(n) < Self.numberWords.count ? Self.numberWords[Int(n)] : String(digits)
        let name = n == 1 ? unit.name : unit.name + "s"
        return "\(countWord) \(name) \(n == 1 ? "passes" : "pass") every \(Notation.blink)\(rate < 0 ? ", backward" : "")"
    }

    /// The speed as the tempo readout says it: "×4,547" · pure "3ι per Blink".
    func speed(_ rate: Double) -> String { pure ? notation.rateLabel(rate) : Self.rate(rate) }

    /// The clock's state in one chip: "Live · ×1", "Paused", "Time-lapse ×3,600", "Backwards ×60" · pure "Live · real
    /// time", "Time-lapse 4ι per Blink".
    func clockChip(live: Bool, rate: Double) -> String {
        if live { return pure ? "Live · real time" : "Live · ×1" }
        if rate == 0 { return "Paused" }
        if rate == 1 { return pure ? "Real time" : "Real time · ×1" }
        if pure { return "\(abs(rate) < 1 ? "Slow motion" : "Time-lapse") \(notation.rateLabel(rate))" }
        return "\(rate < 0 ? "Backwards" : abs(rate) < 1 ? "Slow motion" : "Time-lapse") \(Self.rate(abs(rate)))"
    }

    // MARK: Tempo lock

    /// "×4,547: one η cycle lasts 4.00 s; a quarter (the beat) 1.00 s = 60.0 BPM." · pure "3ι per Blink: one η cycle
    /// lasts 12 Blinks; a quarter lasts 3 Blinks."
    func tempoReadout(depth: Int, rate: Double) -> String {
        let letter = Fractonica.periodName(depth - 1).letter
        guard rate != 0 else {
            return "Paused: the drone holds and the bells wait. Lock a tempo to start the time-lapse: the cycle you choose will last the \(pure ? "Blinks" : "seconds") you set."
        }
        let tempo = SoundSchedule.tempo(depth: depth, rate: rate)
        if pure {
            return "\(notation.rateLabel(rate)): one \(letter) cycle lasts \(span(tempo.cycle)); a quarter lasts \(span(tempo.beat))."
        }
        let bpm = tempo.beat < 20 ? " = \(Self.fixed(tempo.bpm, tempo.bpm < 100 ? 1 : 0)) BPM" : ""
        return "\(Self.rate(rate)): one \(letter) cycle lasts \(Self.seconds(tempo.cycle)); a quarter (the beat) \(Self.seconds(tempo.beat))\(bpm)."
    }

    /// "Locked: one η = 4 s" · pure "Locked: one η = 12 Blinks".
    func lockChip(depth: Int, seconds: Double) -> String {
        "Locked: one \(Fractonica.periodName(depth - 1).letter) = \(pure ? span(seconds) : Self.secondsShort(seconds))"
    }

    /// The toast of a new lock: "Tempo locked: one η cycle = 4.00 s (×4,547)" · pure "… = 12 Blinks (3ι per Blink)".
    func lockToast(depth: Int, seconds: Double, rate: Double) -> String {
        "Tempo locked: one \(Fractonica.periodName(depth - 1).letter) cycle = \(span(seconds)) (\(speed(rate)))"
    }

    func unlockToast(rate: Double) -> String {
        "Tempo unlocked. The speed stays at \(speed(rate)) until you change it."
    }

    /// One chip of the nested rhythm under the tempo lock.
    struct RhythmChip: Hashable, Sendable, Identifiable {
        enum Mark: Hashable, Sendable { case quarters, ends, none }
        let level: Int
        let letter: String
        let length: String
        let mark: Mark
        let off: Bool
        let help: String
        /// The factor to the next chip ("×9"), if one follows.
        let factor: Int?

        var id: Int { level }
    }

    /// The tempo's nested rhythm: the locked depth and up to four finer ones, each with its real length, whether it
    /// rings (on every quarter or on its end) and what it does otherwise.
    func rhythm(depth: Int, rate: Double, prefs: SoundPreferences) -> [RhythmChip] {
        guard rate != 0 else { return [] }
        var chips: [RhythmChip] = []
        var cycle = SoundSchedule.tempo(depth: depth, rate: rate).cycle
        let last = min(SoundTuning.levelCount, depth + 4)
        var d = depth
        while d <= last {
            let level = d - 1
            let info = FractonicaClock.shared.levelInfo(level)
            let off = !prefs.levels[level]
            let mode = off || !prefs.chimes ? nil : SoundSchedule.chimeMode(meanSeconds: info.meanSeconds, rate: rate, floor: prefs.floor)
            let hz = 1 / cycle
            let hzText = pitch(hz)
            let help: String
            if off {
                help = "switched off in the mixer: silent"
            } else if mode == .quarters {
                help = "rings on every quarter"
            } else if mode == .ends {
                help = "rings on its end only"
            } else if !prefs.chord {
                help = prefs.chimes ? "too fast to ring; the Chord layer is off: silent" : "chimes and chord are off: silent"
            } else {
                let lead = prefs.chimes ? "too fast to ring: " : "chimes are off: "
                switch SoundSchedule.amZone(hz) {
                case .full: help = "\(lead)heard as the drone’s modulation at \(hzText)"
                case .fade: help = "\(lead)its modulation of the drone is fading out here (\(hzText))"
                case .rest: help = "\(prefs.chimes ? "too fast to ring and too fast to follow" : "chimes are off") (\(hzText)): the voice rests at its mean loudness"
                }
            }
            let next = cycle / Double(info.factor)
            let more = d < SoundTuning.levelCount && d < last && next >= 0.004
            chips.append(RhythmChip(
                level: level,
                letter: info.letter,
                length: pure ? span(cycle) : Self.seconds(cycle),
                mark: mode == .quarters ? .quarters : mode == .ends ? .ends : .none,
                off: off,
                help: help,
                factor: more ? info.factor : nil
            ))
            guard more else { break }
            cycle = next
            d += 1
        }
        return chips
    }

    // MARK: Status and texts

    /// "Sound is on · 48 kHz · 12 voices" · pure "Sound is on · 12 voices"; out of range or off as sentences.
    func status(on: Bool, inRange: Bool, sampleRate: Double, voices: Int, interrupted: Bool) -> String {
        if !inRange {
            return pure ? "Outside the catalogue (\(notation.catalogueText())): silent" : "Outside the Saros 141 catalogue (1613–2857): silent"
        }
        if interrupted { return "Paused by the system" }
        guard on else { return "Sound is off" }
        var bits = ["Sound is on"]
        if !pure, sampleRate > 0 { bits.append("\(Self.trim(Self.fixed(sampleRate / 1000, 1))) kHz") }
        bits.append("\(voices) voice\(voices == 1 ? "" : "s")")
        return bits.joined(separator: " · ")
    }

    /// The layers that are on: "chord + chimes".
    func layers(_ prefs: SoundPreferences) -> String {
        let on = [("chord", prefs.chord), ("chimes", prefs.chimes), ("physical", prefs.physical)].filter(\.1).map(\.0)
        return on.isEmpty ? "no layer" : on.joined(separator: " + ")
    }

    /// The depths that sound: "depth 1–12", "depth 1–3, 7", "no depth".
    func depths(_ levels: [Bool]) -> String {
        let on = levels.indices.filter { levels[$0] }.map { $0 + 1 }
        guard let first = on.first else { return "no depth" }
        var runs: [String] = []
        var a = first
        var p = first
        for d in on.dropFirst() {
            if d != p + 1 {
                runs.append(a == p ? "\(a)" : "\(a)–\(p)")
                a = d
            }
            p = d
        }
        runs.append(a == p ? "\(a)" : "\(a)–\(p)")
        return "depth \(runs.joined(separator: ", "))"
    }

    /// The moment "Hear this moment" plays: "2026-10-08 12:00:00" · pure "Delta Trifracton End ε#5 34η 29ι".
    func moment(_ t: Double) -> String {
        pure ? notation.dateText(at: t) : wording.dateTime(t)
    }

    /// Four lines on how to listen.
    var how: [(head: String, body: String)] {
        let speed = pure
            ? "Real time is counted in Blinks: one Blink is one ν cycle at real time. Tempo lock sets how many Blinks one cycle lasts; its quarters become the pulses and the subdivisions 5 : 13 : 5 : 5 : 7 : 11 : 9 : 4 … (the series repeats) the rhythm."
            : "Tempo lock turns quarters into beats and the subdivisions 5 : 13 : 5 : 5 : 7 : 11 : 9 : 4 … (the series repeats) into the rhythm."
        return [
            ("Cycles are notes.", "The ratios 1 : 5 : 65 : 325 … folded into one octave are the chord; a voice is loud at its cycle’s peak and silent at its valley."),
            ("Bells are quarters.", "One rings at each peak, node, valley and end; a cycle end strums every finer cycle ending with it, so a major turnover is a big chord."),
            ("Speed makes rhythm.", speed),
            ("Any moment sounds.", "“Hear this moment” plays the chord of the displayed instant, also while you travel through time."),
        ]
    }

    /// What the marks of the rhythm chips mean (the web panel's rhythm legend).
    var rhythmLegend: String {
        "♪ rings a bell on every quarter · ♪ end rings once per cycle, on its end · no mark: too fast to ring at this chime floor. Up to about \(pure ? "9 pB" : "30 Hz") such a cycle is still heard as the drone’s modulation; faster ones rest at their mean loudness. Dashed: switched off in the mixer."
    }

    /// The mixer's one-line legend.
    var mixerHint: String {
        "Tap a letter to mute its voice and a meter to look at it here; hold a meter for where its note comes from. The floor keeps some of a voice at its valley."
    }

    /// What the chime floor does.
    var floorHelp: String {
        "A cycle rings on every quarter only while its quarters are at least this far apart in real time; faster, it rings only its end, and one shorter than the floor rings nothing (up to about \(pure ? "9 pB" : "30 Hz") it is still heard as the drone’s modulation)."
    }

    /// The physical register in a sentence.
    var physicalHelp: String {
        "The true oscillation of the deepest cycles (\(deepRates)) as triangle waves, transposed by whole octaves."
    }
}
