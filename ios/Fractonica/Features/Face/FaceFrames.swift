import FractonicaKit
import Foundation

// What each face draws at one instant, computed once per change from the engine (every level read once) and handed
// to the views as plain values: equal frames redraw nothing. Nil frames are the out-of-catalogue state; nothing is
// ever extrapolated. Checked by Checks/FaceChecks.swift.

/// The journal face at an instant (src/ui/face/journal.js via `Journal.reading`).
struct JournalFrame: Equatable, Sendable {
    struct Token: Equatable, Sendable {
        let level: Int
        let parts: FaceWords.TokenParts
    }

    let unit: Int
    /// The longest unit shown: its phase is the top glyphs and the bottom cycle.
    let leadLevel: Int
    let leadLetter: String
    /// 0 ..< 1 through the lead unit's cycle (the tick on the arcs), in `FaceCadence.arcSteps` steps: between two
    /// steps the arcs compare equal and are not redrawn when only the finer digits turn.
    let phase: Double
    /// Minor units: the lead's phase as a 256-state pair, coarse glyph first (SPEC §15.3).
    let pair: [Int]?
    /// A major period: its phase as one 3-stroke glyph (52 states).
    let glyph3: Int?
    /// Minor units: "34η" "29ι" "21λ", split for colouring.
    let tokens: [Token]
    /// A major period: "5th" "Delta" "Trifracton" "End".
    let lines: [String]
    let accessibilityLabel: String
    /// The middle reading changes no faster than every 1.5 s: its digits may roll (a ν count simply turns).
    let calmText: Bool
    /// The lead glyphs change no faster than every 1.5 s: they may cross-fade (SPEC §10: no blinking).
    let calmGlyphs: Bool

    var isMajor: Bool { glyph3 != nil }

    /// The middle reading as one string ("34η 29ι 21λ").
    var middleText: String {
        tokens.isEmpty ? lines.joined(separator: " ") : tokens.map { $0.parts.prefix + $0.parts.digits + $0.parts.suffix }.joined(separator: " ")
    }

    /// The pair as one number 0 … 255 (or the 3-stroke state), for transitions.
    var glyphKey: Int { glyph3 ?? ((pair?.first ?? 0) * 16 + (pair?.last ?? 0)) }

    /// The face at t with unit `unit`; nil outside the catalogue.
    static func make(at t: Double, unit: Int, notation: Notation = .standard) -> JournalFrame? {
        guard let r = Journal.reading(at: t, unit: unit, notation: notation) else { return nil }
        let pair = r.tokens == nil ? nil : Notation.pair(r.leadPhase)
        let mean = { (level: Int) in notation.model.levelInfo(level).meanSeconds }
        let finest = r.levels.last ?? r.leadLevel
        let glyphStates = Double(r.tokens == nil ? 52 : 256)
        return JournalFrame(
            unit: r.unit,
            leadLevel: r.leadLevel,
            leadLetter: r.leadLetter,
            phase: (r.leadPhase * FaceCadence.arcSteps).rounded() / FaceCadence.arcSteps,
            pair: pair.map { [$0.hi, $0.lo] },
            glyph3: r.major?.index3,
            tokens: (r.tokens ?? []).map { Token(level: $0.level, parts: FaceWords.parts(of: $0.text)) },
            lines: r.major?.lines ?? [],
            accessibilityLabel: FaceWords.journalLabel(r),
            calmText: mean(r.tokens == nil ? min(r.leadLevel + 1, 4) : finest) >= 1.5,
            calmGlyphs: mean(r.leadLevel) / glyphStates >= 1.5
        )
    }
}

/// The watch face at an instant (SPEC §8: two period odometers, sibling counters, the solar odometer, letters and
/// info labels).
struct WatchFrame: Equatable, Sendable {
    struct Period: Equatable, Sendable {
        let level: Int
        let letter: String
        /// Two 2-stroke glyphs, coarse first.
        let digits: [Int]
        /// Sibling counter: `siblings` dots, lit through `local`.
        let siblings: Int
        let local: Int
        /// Pure mode: the running cycle's name under the letter ("Delta Trifracton", "ε#5 34η").
        let name: String
        let accessibilityLabel: String
        /// A glyph that changes no faster than every 1.5 s may cue its change (SPEC §10: no blinking).
        let calmCoarse: Bool
        let calmFine: Bool
    }

    let topDepth: Int
    let top: Period
    let bottom: Period
    /// Three 2-stroke glyphs; nil where the sync is not defined (near the catalogue's ends).
    let solar: [Int]?
    let solarLabel: String
    /// The info labels (computed only when asked for).
    let info: FaceWords.InfoLabels?

    var accessibilityLabel: String {
        "Watch face: \(top.letter) depth \(top.level + 1) over \(bottom.letter) depth \(bottom.level + 1)"
    }

    /// The face at t; nil outside the catalogue.
    static func make(at t: Double, topDepth: Int, words: Wording, info: Bool = false) -> WatchFrame? {
        let clock = words.notation.model
        let depth = FaceStepper.clampDepth(topDepth)
        let levels = WatchGeometry.levels(topDepth: depth)
        guard let lTop = clock.level(at: t, levels.top), let lBottom = clock.level(at: t, levels.bottom),
              let oTop = clock.odometer(at: t, levels.top), let oBottom = clock.odometer(at: t, levels.bottom) else { return nil }
        let solar = clock.solar(at: t)
        func period(_ level: Int, _ lv: LevelReading, _ odo: OdometerReading) -> Period {
            let mean = clock.levelInfo(level).meanSeconds
            return Period(
                level: level,
                letter: Fractonica.periodName(level).text,
                digits: odo.digits,
                siblings: lv.siblings,
                local: lv.local,
                name: words.pure ? FaceWords.letterName(level: level, cycle: lv.cycle, notation: words.notation) : "",
                accessibilityLabel: FaceWords.rowLabel(level: level, reading: lv, digits: odo.digits, words: words),
                calmCoarse: mean / 16 >= 1.5,
                calmFine: mean / 256 >= 1.5
            )
        }
        return WatchFrame(
            topDepth: depth,
            top: period(levels.top, lTop, oTop),
            bottom: period(levels.bottom, lBottom, oBottom),
            solar: solar?.digits3,
            solarLabel: FaceWords.solarLabel(solar, pure: words.pure),
            info: info ? FaceWords.infoLabels(at: t, top: lTop, solar: solar, words: words) : nil
        )
    }
}
