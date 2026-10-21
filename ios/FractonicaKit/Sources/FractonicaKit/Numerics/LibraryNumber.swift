/// `F.number`: how `fractonica.js` turns an exact rational into a JavaScript number.
///
/// The library does not round correctly. It takes the first 16 decimal digits of the numerator and of the
/// denominator, divides the two leading values, prints that mantissa and parses it back with the decimal exponent:
///
/// ```js
/// const leading = (s) => Number(s.slice(0, 16)) / 10 ** (Math.min(16, s.length) - 1);
/// const mantissa = sign * leading(n) / leading(d);
/// return Number(`${mantissa}e${n.length - d.length}`);
/// ```
///
/// The result can sit an ulp or two from the nearest double (12 of the 70 catalogue instants do). The web model
/// converts every time, phase and drift this way, and a level-13 cycle lasts 44 ms, so an ulp in a cycle's start
/// (0.24 µs today) moves its time-linear progress by 5e-6. Repeating the rule keeps the port bit-identical.
extension Ratio {
    var libraryDouble: Double {
        let (n, nDigits) = Self.leading(numerator.magnitude)
        let (d, dDigits) = Self.leading(denominator.magnitude)
        let mantissa = (numerator < 0 ? -1.0 : 1.0) * n / d
        // `mantissa` lies in (0.1, 10): its description is the plain shortest round-trip form, as in JS.
        return Double("\(mantissa)e\(nDigits - dDigits)")!
    }

    /// The leading value `Number(s.slice(0, 16)) / 10 ** (min(16, s.length) - 1)` of a magnitude's decimal string `s`,
    /// and the length of `s`.
    private static func leading(_ v: UInt128) -> (value: Double, digits: Int) {
        var digits = 1
        while digits < powersOfTen.count, v >= powersOfTen[digits] { digits += 1 }
        let head = digits > 16 ? v / powersOfTen[digits - 16] : v
        // `head` < 10^16 fits UInt64; the conversion rounds to nearest even, like parsing the digit string.
        return (Double(UInt64(head)) / exactPowersOfTen[min(16, digits) - 1], digits)
    }

    /// 10^0 … 10^38 (every power of ten below `UInt128.max`).
    private static let powersOfTen: [UInt128] = {
        var out: [UInt128] = [1]
        while out.count < 39 { out.append(out[out.count - 1] * 10) }
        return out
    }()

    /// 10^0 … 10^15 as doubles (all exact, as JS's `10 ** k`).
    private static let exactPowersOfTen: [Double] = (0..<16).map { k in
        (0..<k).reduce(1.0) { p, _ in p * 10 }
    }
}
