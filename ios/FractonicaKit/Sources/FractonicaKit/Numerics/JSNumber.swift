import Foundation

/// JavaScript's number semantics where the web app's output depends on them: `Math.round`, `String(number)`,
/// `toFixed` and `toPrecision`.
///
/// The notation (pure.js) and Earth formatting (format.js) print numbers through these, so the Swift port reproduces
/// them bit for bit rather than approximating with `String(format:)`:
/// - `Math.round` rounds half up (toward +∞), not away from zero.
/// - `String(x)` prints the shortest digits that round-trip (Swift's `description` finds the same digits) in
///   ECMAScript's layout: plain decimals from 1e-6 up to 1e21, exponential (`1e-7`, `1.5e+21`) outside.
/// - `toFixed` / `toPrecision` round the *exact binary value* of the double, ties toward the larger result
///   (`(0.125).toPrecision(2)` is `"0.13"`, `(1.005).toFixed(2)` is `"1.00"`). C's printf rounds ties to even, so
///   these are computed here with exact integer arithmetic.
enum JSNumber {
    /// `Math.round(x)`: nearest integer, halves toward +∞, keeping −0 for −0.5 ≤ x < 0.
    static func round(_ x: Double) -> Double {
        guard x.isFinite, x != 0 else { return x }
        let down = x.rounded(.down)
        let r = x - down >= 0.5 ? down + 1 : down
        return r == 0 && x < 0 ? -0.0 : r
    }

    /// `String(x)` (Number::toString, radix 10).
    static func string(_ x: Double) -> String {
        if x.isNaN { return "NaN" }
        if x == 0 { return "0" }
        if x < 0 { return "-" + string(-x) }
        if x.isInfinite { return "Infinity" }
        let (digits, point) = shortestDigits(x)
        let k = digits.count
        if k <= point && point <= 21 {
            return digits + String(repeating: "0", count: point - k)
        }
        if 0 < point && point <= 21 {
            let cut = digits.index(digits.startIndex, offsetBy: point)
            return digits[..<cut] + "." + digits[cut...]
        }
        if -6 < point && point <= 0 {
            return "0." + String(repeating: "0", count: -point) + digits
        }
        let exponent = point - 1
        let sign = exponent >= 0 ? "+" : "-"
        let mantissa = k == 1 ? digits : String(digits.prefix(1)) + "." + digits.dropFirst()
        return mantissa + "e" + sign + String(abs(exponent))
    }

    /// `x.toFixed(fractionDigits)`.
    static func fixed(_ x: Double, _ fractionDigits: Int) -> String {
        guard x.isFinite else { return string(x) }
        if abs(x) >= 1e21 { return string(x) }
        let sign = x < 0 ? "-" : ""
        guard let n = scaledRoundHalfUp(abs(x), scale: fractionDigits) else {
            return String(format: "%.\(fractionDigits)f", x)
        }
        var digits = String(n)
        if fractionDigits == 0 { return sign + digits }
        if digits.count <= fractionDigits {
            digits = String(repeating: "0", count: fractionDigits + 1 - digits.count) + digits
        }
        let cut = digits.index(digits.endIndex, offsetBy: -fractionDigits)
        return sign + digits[..<cut] + "." + digits[cut...]
    }

    /// `Number(x.toPrecision(precision))`: `x` rounded to `precision` significant digits, as a number again.
    static func precision(_ x: Double, _ precision: Int) -> Double {
        guard x.isFinite, x != 0 else { return x }
        let magnitude = abs(x)
        // e = floor(log10 |x|), corrected exactly so that 10^(p−1) <= floor(|x|·10^(p−1−e)) < 10^p.
        var e = Int(log10(magnitude).rounded(.down))
        let low = pow10(precision - 1), high = pow10(precision)
        while let f = scaledFloor(magnitude, scale: precision - 1 - e), f >= high { e += 1 }
        while let f = scaledFloor(magnitude, scale: precision - 1 - e), f < low { e -= 1 }
        guard var n = scaledRoundHalfUp(magnitude, scale: precision - 1 - e) else {
            return Double(String(format: "%.\(precision - 1)e", x))!
        }
        if n == high {
            n = low
            e += 1
        }
        return Double("\(x < 0 ? "-" : "")\(n)e\(e - precision + 1)")!
    }

    /// Shortest round-trip decimal digits of a finite positive double, without leading or trailing zeros, and the
    /// position of the decimal point: x = 0.d₁d₂…dₖ × 10^point.
    private static func shortestDigits(_ x: Double) -> (digits: String, point: Int) {
        let text = x.description // shortest round-trip digits, e.g. "123.45", "1e-07", "1.2345e+20"
        var mantissa = Substring(text)
        var exponent = 0
        if let e = text.firstIndex(where: { $0 == "e" || $0 == "E" }) {
            mantissa = text[..<e]
            exponent = Int(text[text.index(after: e)...])!
        }
        let parts = mantissa.split(separator: ".", omittingEmptySubsequences: false)
        let whole = parts[0], fraction = parts.count > 1 ? parts[1] : ""
        var digits = Array(whole + fraction)
        var point = whole.count + exponent
        while digits.first == "0" {
            digits.removeFirst()
            point -= 1
        }
        while digits.last == "0" { digits.removeLast() }
        return (String(digits), point)
    }

    // MARK: - Exact scaling

    /// round(|x| · 10^scale), halves up, from the exact binary value of x; nil if the exact terms overflow 128 bits.
    private static func scaledRoundHalfUp(_ x: Double, scale: Int) -> UInt128? {
        guard let (q, r, d) = scaledDivision(x, scale: scale) else { return nil }
        return r >= d - r ? q + 1 : q
    }

    /// floor(|x| · 10^scale) from the exact binary value of x; nil if the exact terms overflow 128 bits.
    private static func scaledFloor(_ x: Double, scale: Int) -> UInt128? {
        scaledDivision(x, scale: scale)?.quotient
    }

    /// |x| · 10^scale as an exact fraction a/b, divided: (a div b, a mod b, b).
    private static func scaledDivision(_ x: Double, scale: Int) -> (quotient: UInt128, remainder: UInt128, divisor: UInt128)? {
        let v = abs(x)
        guard v.isFinite else { return nil }
        if v == 0 { return (0, 0, 1) }
        // v = m · 2^q with m a 53-bit integer.
        var m = UInt128(v.significandBitPattern) | (v.isNormal ? UInt128(1) << 52 : 0)
        var q = Int(v.isNormal ? v.exponent : Double.leastNormalMagnitude.exponent) - 52
        let tz = m.trailingZeroBitCount
        m >>= tz
        q += tz
        var a = m, b: UInt128 = 1
        if q >= 0 {
            guard q < 128, let shifted = multiply(a, UInt128(1) << q) else { return nil }
            a = shifted
        } else {
            guard -q < 127 else { return nil }
            b = UInt128(1) << -q
        }
        if scale >= 0 {
            guard let p = pow10Checked(scale), let scaled = multiply(a, p) else { return nil }
            a = scaled
        } else {
            guard let p = pow10Checked(-scale), let scaled = multiply(b, p) else { return nil }
            b = scaled
        }
        return (a / b, a % b, b)
    }

    private static func multiply(_ a: UInt128, _ b: UInt128) -> UInt128? {
        let (p, overflow) = a.multipliedReportingOverflow(by: b)
        return overflow ? nil : p
    }

    private static func pow10Checked(_ n: Int) -> UInt128? {
        guard n >= 0, n <= 38 else { return nil }
        return pow10(n)
    }

    private static func pow10(_ n: Int) -> UInt128 {
        var p: UInt128 = 1
        for _ in 0..<n { p *= 10 }
        return p
    }
}
