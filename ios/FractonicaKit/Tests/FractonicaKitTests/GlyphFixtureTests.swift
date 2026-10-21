import CoreGraphics
import Testing
@testable import FractonicaKit

/// Glyph states and geometry against glyphs.json (the library's `CBT.fromIndex` and `CBT.geometry`).
@Suite("Glyph fixtures")
struct GlyphFixtureTests {
    let fixture = Fixtures.glyphs

    @Test("Every 1-, 2- and 3-stroke state: value, derivative, trits, dot and path")
    func states() {
        var check = Checker("glyph states")
        var counts: [Int: Int] = [:]
        for row in fixture["states"].array {
            let strokes = row["strokes"].int, index = row["index"].int
            let what = "\(strokes) strokes #\(index)"
            counts[strokes, default: 0] += 1
            let g = GlyphState.of(index: index, strokes: strokes)
            check.equal(g.index, index, "\(what) index")
            check.equal(g.value, row["value"].int, "\(what) value")
            check.equal(g.derivative, row["derivative"].int, "\(what) derivative")
            check.equal(g.trits, row["trits"].ints, "\(what) trits")
            check.equal(g.dotted, row["dotted"].bool, "\(what) dot")
            let expected = row["commands"].array.map { c -> GlyphGeometry.Command in
                let v = c.array.dropFirst().map(\.double)
                switch c[0].string {
                case "M": return .move(x: v[0], y: v[1])
                case "L": return .line(x: v[0], y: v[1])
                default: return .curve(x1: v[0], y1: v[1], x2: v[2], y2: v[3], x: v[4], y: v[5])
                }
            }
            check.equal(GlyphGeometry.commands(index: index, strokes: strokes), expected, "\(what) path \(row["path"].string)")
        }
        check.equal(counts, [1: 4, 2: 16, 3: 52], "states per stroke count")
        for (index, row) in fixture["states4"].array.enumerated() {
            let g = GlyphState.of(index: index, strokes: 4)
            check.equal([g.value, g.derivative], [row[0].int, row[1].int], "4 strokes #\(index)")
            check.equal(g.trits, row[2].ints, "4 strokes #\(index) trits")
        }
        for row in fixture["wrap"].array {
            check.equal(GlyphState.of(index: row["index"].int, strokes: row["strokes"].int).index, row["k"].int,
                        "wrap \(row["index"].int) at \(row["strokes"].int) strokes")
        }
        for strokes in 1...4 {
            check.equal(GlyphState.states(strokes: strokes), [4, 16, 52, 160][strokes - 1], "states(\(strokes))")
        }
        check.report()
    }

    @Test("Bounds, ink and dot")
    func bounds() {
        var check = Checker("glyph bounds")
        for row in fixture["bounds"].array {
            let b = GlyphGeometry.bounds(strokes: row["strokes"].int)
            check.equal([b.minX, b.minY, b.maxX, b.maxY],
                        [row["minX"].double, row["minY"].double, row["maxX"].double, row["maxY"].double],
                        "bounds \(row["strokes"].int)")
            check.equal(GlyphGeometry.dotCenter.y, row["dotY"].double, "dotY")
        }
        let dot = fixture["dot"]
        check.equal([GlyphGeometry.dotCenter.x, GlyphGeometry.dotCenter.y, GlyphGeometry.dotRadius],
                    [dot["x"].double, dot["y"].double, dot["radius"].double], "dot")
        check.equal(GlyphGeometry.thickness, 0.3, "thickness")
        // the CoreGraphics path covers the same points
        let box = GlyphGeometry.cgPath(index: 5, strokes: 2).boundingBoxOfPath
        check.equal([box.minX, box.minY, box.maxX, box.maxY], [-1, 0, 2, 6], "cgPath bounding box of state 5")
        check.report()
    }

    @Test("The CoreGraphics path replays the commands of every 1- to 4-stroke state")
    func coreGraphics() {
        var check = Checker("cgPath")
        for strokes in 1...4 {
            for index in 0..<GlyphState.states(strokes: strokes) {
                var replayed: [GlyphGeometry.Command] = []
                GlyphGeometry.cgPath(index: index, strokes: strokes).applyWithBlock { element in
                    let e = element.pointee
                    switch e.type {
                    case .moveToPoint:
                        replayed.append(.move(x: e.points[0].x, y: e.points[0].y))
                    case .addLineToPoint:
                        replayed.append(.line(x: e.points[0].x, y: e.points[0].y))
                    case .addCurveToPoint:
                        replayed.append(.curve(x1: e.points[0].x, y1: e.points[0].y, x2: e.points[1].x, y2: e.points[1].y,
                                               x: e.points[2].x, y: e.points[2].y))
                    default:
                        replayed.append(.move(x: .nan, y: .nan)) // quad curves and closes are never drawn
                    }
                }
                check.equal(replayed, GlyphGeometry.commands(index: index, strokes: strokes), "\(strokes) strokes #\(index)")
            }
        }
        check.report()
    }
}
