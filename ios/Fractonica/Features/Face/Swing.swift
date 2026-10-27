import Foundation

/// The swing law of what swings on a face (the analog face's balance): angle = A · sin(2π · phase). It leaves the
/// centre at the cycle's start, reaches its right extreme at the peak (¼), passes the centre at the node (½), its left
/// extreme at the valley (¾) and is home at the end: two swings, right then left, per period.
enum Swing {
    static func angle(phase: Double, amplitude: Double) -> Double { amplitude * sin(2 * .pi * phase) }

    /// Speed relative to the fastest (through the centre): 1 at the start and node, 0 at the peak and valley.
    static func speed(phase: Double) -> Double { abs(cos(2 * .pi * phase)) }

    /// +1 while the bob moves right (to the peak, and back from the valley), −1 while it moves left.
    static func heading(phase: Double) -> Double { cos(2 * .pi * phase) >= 0 ? 1 : -1 }

    /// 0 … 3: the quarter, named by the threshold that ends it (peak, node, valley, end).
    static func quarter(phase: Double) -> Int { min(3, max(0, Int((phase * 4).rounded(.down)))) }
}
