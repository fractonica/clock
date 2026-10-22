import CoreGraphics
import FractonicaKit
import Foundation

// The geometry of the two faces in their own coordinate space (SPEC §8–§10, src/ui/face/helpers.js and journal.js):
// a 192 × 490 pill with corner radius 96, plus a 6-unit bezel on every side. One unit is one pixel of the reference
// watch screen; the views scale the whole space to fit (`FaceFit`), so the faces are crisp at any size. Nothing here
// touches SwiftUI or the clock: it is checked by Checks/FaceChecks.swift.

/// The face's logical screen (SPEC §8: 192 × 490 px, pill-shaped).
enum FaceSpace {
    static let width: CGFloat = 192
    static let height: CGFloat = 490
    /// Corner radius: the ends are half circles.
    static let radius: CGFloat = 96
    static let cx: CGFloat = 96
    static let cy: CGFloat = 245
    /// Room for the rim around the screen, on every side.
    static let bezel: CGFloat = 6
    /// The frame a face view occupies: the screen and its bezel.
    static let frameWidth = width + 2 * bezel
    static let frameHeight = height + 2 * bezel
    /// Width ÷ height of that frame.
    static let aspectRatio = frameWidth / frameHeight

    /// Is a logical point on the pill-shaped screen?
    static func contains(_ p: CGPoint) -> Bool {
        guard p.x >= 0, p.x <= width, p.y >= 0, p.y <= height else { return false }
        let top = radius
        let bottom = height - radius
        if p.y < top { return hypot(p.x - cx, p.y - top) <= radius }
        if p.y > bottom { return hypot(p.x - cx, p.y - bottom) <= radius }
        return true
    }
}

/// Maps the face's logical units into a view of a given size (aspect fit, centred): the logical screen origin (the
/// pill's top-left corner) lands at `origin`, one unit is `scale` points.
struct FaceFit: Equatable, Sendable {
    let scale: CGFloat
    let origin: CGPoint

    init(size: CGSize) {
        let s = max(0, min(size.width / FaceSpace.frameWidth, size.height / FaceSpace.frameHeight))
        scale = s
        origin = CGPoint(
            x: (size.width - FaceSpace.frameWidth * s) / 2 + FaceSpace.bezel * s,
            y: (size.height - FaceSpace.frameHeight * s) / 2 + FaceSpace.bezel * s
        )
    }

    /// A logical point in view coordinates.
    func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
        CGPoint(x: origin.x + x * scale, y: origin.y + y * scale)
    }

    /// A logical length in points.
    func length(_ v: CGFloat) -> CGFloat { v * scale }

    /// A logical rectangle in view coordinates.
    func rect(_ r: CGRect) -> CGRect {
        CGRect(x: origin.x + r.minX * scale, y: origin.y + r.minY * scale, width: r.width * scale, height: r.height * scale)
    }

    /// A view point in logical units (for taps).
    func logical(_ p: CGPoint) -> CGPoint {
        guard scale > 0 else { return .zero }
        return CGPoint(x: (p.x - origin.x) / scale, y: (p.y - origin.y) / scale)
    }

    /// The pill (the screen without its bezel) in view coordinates.
    var screen: CGRect { rect(CGRect(x: 0, y: 0, width: FaceSpace.width, height: FaceSpace.height)) }
}

/// Where a tap or a key lands on a face.
enum FaceRegion: Equatable, Sendable {
    case top, middle, bottom

    /// The step a tap in this region asks for: −1 one unit or depth longer (top), +1 shorter (bottom).
    var step: Int? {
        switch self {
        case .top: -1
        case .bottom: 1
        case .middle: nil
        }
    }
}

// MARK: - The journal face (src/ui/face/journal.js)

/// Layout of the journal face, in logical units.
enum JournalGeometry {
    /// The tap thirds: above `topEnd` one unit longer, below `bottomStart` one unit shorter.
    static let topEnd = FaceSpace.height / 3
    static let bottomStart = 2 * FaceSpace.height / 3

    /// The lead unit's phase: the 2-stroke pair (or the major period's 3-stroke glyph) centred here.
    static let glyphCenterY: CGFloat = 92
    static let pairGlyphHeight: CGFloat = 70
    /// Gap between the two glyphs of the pair, in logical units.
    static let pairGap: CGFloat = 12
    static let majorGlyphHeight: CGFloat = 92
    /// The lead unit's letter under the pair.
    static let topLetterY: CGFloat = 148
    static let letterSize: CGFloat = 13

    /// The middle reading: centred at the screen's centre, never wider than this.
    static let middleWidth: CGFloat = 176
    /// One size for every minor reading, so "34η 29ι 21λ" and "ε#05 34η 29ι" read alike (owner: counts in two digits
    /// "so the font size doesn't change").
    static let minorTextSize: CGFloat = 27

    /// The cycle at the bottom: two half-arcs of radius `arcRadius` on the axis `arcY`.
    static let arcRadius: CGFloat = 38
    static let arcY: CGFloat = 392
    static var leftArcCenterX: CGFloat { FaceSpace.cx - arcRadius }
    static var rightArcCenterX: CGFloat { FaceSpace.cx + arcRadius }
    static let bottomLetterY: CGFloat = 460
    /// The cycle fractions marked with dots: start, deepest, middle, highest, end.
    static let quarterMarks: [Double] = [0, 0.25, 0.5, 0.75, 1]

    /// The point at cycle fraction f on the two half-arcs, with the outward normal (`Journal.arcPoint`).
    static func arcPoint(_ f: Double) -> (point: CGPoint, normal: CGVector) {
        let q = Journal.arcPoint(f.isFinite ? f : 0, cl: Double(leftArcCenterX), cr: Double(rightArcCenterX),
                                 cy: Double(arcY), r: Double(arcRadius))
        return (CGPoint(x: q.x, y: q.y), CGVector(dx: q.nx, dy: q.ny))
    }

    /// Which third a logical point is in; nil off the face (the bezel and beyond count as the face).
    static func region(at p: CGPoint) -> FaceRegion? {
        let b = FaceSpace.bezel
        guard p.x >= -b, p.x <= FaceSpace.width + b, p.y >= -b, p.y <= FaceSpace.height + b else { return nil }
        if p.y < topEnd { return .top }
        if p.y > bottomStart { return .bottom }
        return .middle
    }
}

// MARK: - The watch face (SPEC §8–§10, src/ui/face/screen.js and helpers.js)

/// Layout of the spec's watch face, in logical units (1 design unit = 10 units, SPEC §9.2).
enum WatchGeometry {
    enum Row: CaseIterable, Sendable {
        case top, solar, bottom
    }

    /// Logical units per glyph design unit; 0.3 units of ink = 3 px.
    static let unit: CGFloat = 10
    /// Period pairs ±165 from the centre, letters and labels ±90.
    static let periodDY: CGFloat = 165
    static let labelDY: CGFloat = 90
    /// Distance between glyph stems: 80 in the period pairs, 64 in the three-glyph solar odometer.
    static let periodDX: CGFloat = 80
    static let solarDX: CGFloat = 64
    /// A glyph's origin (the top of its stem) sits 20.5 above its row's centre (SPEC §9.2).
    static let originDY: CGFloat = 20.5
    /// Stems are shifted half a pixel so a 3 px stroke covers whole pixel columns.
    static let pixelShift: CGFloat = 0.5
    /// Sibling counters: dots on arcs concentric with the rounded ends.
    static let counterRadius: CGFloat = FaceSpace.width / 2 - 10
    static let counterStepDegrees: CGFloat = 11.5
    /// Beyond this distance from the centre a tap belongs to the top or bottom region.
    static let regionHalf: CGFloat = 100
    /// Highlight plate of a row (the selected level).
    static let plateInset: CGFloat = 8
    static let plateRadius: CGFloat = 22

    static func rowCenterY(_ row: Row) -> CGFloat {
        switch row {
        case .top: FaceSpace.cy - periodDY
        case .solar: FaceSpace.cy
        case .bottom: FaceSpace.cy + periodDY
        }
    }

    static func glyphCount(_ row: Row) -> Int { row == .solar ? 3 : 2 }

    /// Stem distance of a row.
    static func stemDistance(_ row: Row) -> CGFloat { row == .solar ? solarDX : periodDX }

    /// The design-unit gap between neighbouring glyph bounds that puts the stems `stemDistance` apart.
    static func designSpacing(_ row: Row, glyphWidth: CGFloat = 4.3) -> CGFloat {
        stemDistance(row) / unit - glyphWidth
    }

    /// The logical rectangle holding a row's glyphs at 10 units per design unit (bounds x ±2.15, y −2.2 … 3d + 0.15,
    /// SPEC §9.1), with the stems placed as in helpers.js `glyphOrigins`.
    static func glyphRect(_ row: Row, strokes: Int = 2) -> CGRect {
        let n = CGFloat(glyphCount(row))
        let dx = stemDistance(row)
        let firstStem = FaceSpace.cx + pixelShift - (n - 1) / 2 * dx
        let originY = rowCenterY(row) - originDY
        let minX = firstStem - 2.15 * unit
        let width = (n - 1) * dx + 4.3 * unit
        let minY = originY - 2.2 * unit
        let height = (3 * CGFloat(strokes) + 2.35) * unit
        return CGRect(x: minX, y: minY, width: width, height: height)
    }

    /// The highlight plate behind a row.
    static func plate(_ row: Row) -> CGRect {
        rowBox(row).insetBy(dx: plateInset, dy: 0)
    }

    /// `count` counter dots on the arc of the top or bottom end, centred on the vertical axis, read left to right
    /// (helpers.js `counterPositions`).
    static func counterPositions(count: Int, top: Bool) -> [CGPoint] {
        guard count > 0 else { return [] }
        let cy = top ? FaceSpace.radius : FaceSpace.height - FaceSpace.radius
        return (0..<count).map { i in
            let deg = (CGFloat(i) - CGFloat(count - 1) / 2) * counterStepDegrees
            let a = deg * .pi / 180
            let x = FaceSpace.cx + counterRadius * sin(a)
            let y = top ? cy - counterRadius * cos(a) : cy + counterRadius * cos(a)
            return CGPoint(x: x, y: y)
        }
    }

    /// The hit box of a row (helpers.js `ROW_BOX`): the plate before its inset.
    static func rowBox(_ row: Row) -> CGRect {
        CGRect(x: 22, y: rowCenterY(row) - 46, width: 148, height: 92)
    }

    /// The glyph row under a logical point (helpers.js `hitTest(…).row`); nil between the rows or off the pill. A top
    /// or bottom row always lies in its tap region.
    static func row(at p: CGPoint) -> Row? {
        guard FaceSpace.contains(p) else { return nil }
        return Row.allCases.first { rowBox($0).contains(p) }
    }

    /// The tap region of a logical point; nil off the pill.
    static func region(at p: CGPoint) -> FaceRegion? {
        guard FaceSpace.contains(p) else { return nil }
        if p.y < FaceSpace.cy - regionHalf { return .top }
        if p.y > FaceSpace.cy + regionHalf { return .bottom }
        return .middle
    }

    /// The two levels a top depth shows: depth D (level D−1) over depth D+1 (level D).
    static func levels(topDepth: Int) -> (top: Int, bottom: Int) {
        let d = FaceStepper.clampDepth(topDepth)
        return (d - 1, d)
    }
}

// MARK: - Steps, taps, swipes

/// Moving through the journal units and the watch depths (SPEC §10: top depth 2…11; journal units 0…6).
enum FaceStepper {
    static let depths = 2...11
    static let units = 0...6

    static func clampDepth(_ d: Int) -> Int { min(depths.upperBound, max(depths.lowerBound, d)) }
    static func clampUnit(_ u: Int) -> Int { min(units.upperBound, max(units.lowerBound, u)) }

    /// The unit after a step (−1 longer, +1 shorter); nil when there is no further unit.
    static func unit(_ u: Int, step: Int) -> Int? {
        let current = clampUnit(u)
        let next = clampUnit(current + step.signum())
        return next == current ? nil : next
    }

    /// The top depth after a step (−1 longer, +1 shorter); nil at the end of the range.
    static func depth(_ d: Int, step: Int) -> Int? {
        let current = clampDepth(d)
        let next = clampDepth(current + step.signum())
        return next == current ? nil : next
    }

    /// The journal unit whose first (longest) letter is unit index `i` of `Journal.units` (α … ν, 0 … 8): the window
    /// starting there, or the last window (ι λ ν) for λ and ν.
    static func unit(startingAt i: Int) -> Int { clampUnit(i) }

    /// The top depth that puts depth `d` on the face: itself, or 11 for depth 12 (it is then the lower period).
    static func depth(showing d: Int) -> Int { clampDepth(d) }
}

/// What a single tap in the middle of the watch face does: the first shows the info labels, a second within 0.4 s
/// toggles the period letters (helpers.js `middleTap`). A double tap consumes the sequence, so a quick third tap
/// starts a new one instead of toggling the letters back.
enum MiddleTap {
    static let window: TimeInterval = 0.4

    enum Action: Equatable { case info, letters }

    /// - Parameters:
    ///   - previous: the time of the remembered middle tap, if any.
    ///   - now: this tap's time.
    /// - Returns: the action and the tap time to remember (nil after a double tap).
    static func resolve(previous: TimeInterval?, now: TimeInterval) -> (action: Action, remember: TimeInterval?) {
        if let previous, now - previous >= 0, now - previous <= window { return (.letters, nil) }
        return (.info, now)
    }
}

/// How a drag across the Now screen is read: a horizontal one pages between the faces, a vertical one steps the
/// face's unit or depth (swipe up for shorter, down for longer, like scrolling the ladder).
enum FaceSwipe {
    enum Axis: Equatable { case horizontal, vertical }

    /// The axis a drag is locked to once it has moved `threshold` points; nil before.
    static func axis(of translation: CGSize, threshold: CGFloat = 10) -> Axis? {
        let dx = abs(translation.width)
        let dy = abs(translation.height)
        guard max(dx, dy) >= threshold else { return nil }
        return dx > dy ? .horizontal : .vertical
    }

    /// A finished vertical drag: −1 (longer, dragged down), +1 (shorter, dragged up), nil when too short.
    static func step(translation: CGFloat, predicted: CGFloat, threshold: CGFloat = 36) -> Int? {
        let d = abs(predicted) > abs(translation) ? predicted : translation
        guard abs(d) >= threshold, abs(translation) >= threshold / 3 else { return nil }
        return d < 0 ? 1 : -1
    }

    /// A finished horizontal drag on page `page` of `count`: the page to settle on.
    static func page(_ page: Int, count: Int, translation: CGFloat, predicted: CGFloat, width: CGFloat) -> Int {
        guard width > 0 else { return page }
        let d = abs(predicted) > abs(translation) ? predicted : translation
        var next = page
        if d < -width / 3 || translation < -width / 4 { next = page + 1 }
        if d > width / 3 || translation > width / 4 { next = page - 1 }
        return min(count - 1, max(0, next))
    }

    /// The offset a horizontal drag shows: the finger's travel, damped past the first and last page.
    static func rubberBand(_ translation: CGFloat, page: Int, count: Int, width: CGFloat) -> CGFloat {
        let pastStart = page == 0 && translation > 0
        let pastEnd = page == count - 1 && translation < 0
        guard pastStart || pastEnd, width > 0 else { return translation }
        let x = abs(translation)
        let damped = (1 - 1 / (x * 0.55 / width + 1)) * width * 0.5
        return translation < 0 ? -damped : damped
    }
}
