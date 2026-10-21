/// Exact rational arithmetic on 128-bit integers: the part of `fractonica.js`'s BigInt rationals the clock needs.
///
/// A `Ratio` is always in lowest terms with a positive denominator, exactly like the library's `rational()`. That
/// matters beyond tidiness: `F.number` (see `Ratio.libraryDouble`) reads the decimal digits of the *reduced*
/// numerator and denominator, so the same value in other terms could round to a different `Double`.
///
/// Every quantity the clock forms on the Saros 141 catalogue (positions with millisecond or microsecond
/// denominators, prefixes down to depth 21, odometer step counts) stays far below `Int128.max`; arithmetic traps on
/// overflow instead of wrapping, so a violated bound fails loudly in tests.
struct Ratio: Hashable, Sendable, Comparable {
    let numerator: Int128
    let denominator: Int128

    /// `numerator / denominator`, reduced. The denominator must not be zero.
    init(_ numerator: Int128, _ denominator: Int128 = 1) {
        precondition(denominator != 0, "Ratio with a zero denominator")
        let g = Int128(gcd(numerator.magnitude, denominator.magnitude))
        let sign: Int128 = denominator < 0 ? -1 : 1
        self.numerator = sign * (numerator / g)
        self.denominator = sign * (denominator / g)
    }

    /// Trusted constructor for values already in lowest terms with a positive denominator.
    private init(reduced numerator: Int128, _ denominator: Int128) {
        self.numerator = numerator
        self.denominator = denominator
    }

    static let zero = Ratio(reduced: 0, 1)

    var isZero: Bool { numerator == 0 }

    /// Mathematical floor (the library's `floor`; Swift's `/` truncates toward zero).
    var floor: Int128 {
        let q = numerator / denominator
        return numerator < 0 && q * denominator != numerator ? q - 1 : q
    }

    static func + (a: Ratio, b: Ratio) -> Ratio {
        let g = Int128(gcd(a.denominator.magnitude, b.denominator.magnitude))
        let ad = a.denominator / g
        return Ratio(a.numerator * (b.denominator / g) + b.numerator * ad, ad * b.denominator)
    }

    static func - (a: Ratio, b: Ratio) -> Ratio {
        a + Ratio(reduced: -b.numerator, b.denominator)
    }

    static func * (a: Ratio, b: Ratio) -> Ratio {
        if a.isZero || b.isZero { return .zero }
        // Cross-cancel first so the products stay small and the result is already reduced.
        let g1 = Int128(gcd(a.numerator.magnitude, b.denominator.magnitude))
        let g2 = Int128(gcd(b.numerator.magnitude, a.denominator.magnitude))
        return Ratio(reduced: (a.numerator / g1) * (b.numerator / g2), (a.denominator / g2) * (b.denominator / g1))
    }

    static func / (a: Ratio, b: Ratio) -> Ratio {
        precondition(!b.isZero, "Ratio division by zero")
        let sign: Int128 = b.numerator < 0 ? -1 : 1
        return a * Ratio(reduced: sign * b.denominator, sign * b.numerator)
    }

    static func < (a: Ratio, b: Ratio) -> Bool {
        a.numerator * b.denominator < b.numerator * a.denominator
    }
}

/// Greatest common divisor (binary GCD: shifts and subtractions only, no 128-bit division). `gcd(0, b) == b`.
func gcd(_ a: UInt128, _ b: UInt128) -> UInt128 {
    if a == 0 { return b }
    if b == 0 { return a }
    let shift = (a | b).trailingZeroBitCount
    var u = a >> a.trailingZeroBitCount
    var v = b
    repeat {
        v >>= v.trailingZeroBitCount
        if u > v { swap(&u, &v) }
        v -= u
    } while v != 0
    return u << shift
}

/// Greatest common divisor on 64 bits, for positions (whose terms fit `Int64`).
func gcd(_ a: UInt64, _ b: UInt64) -> UInt64 {
    if a == 0 { return b }
    if b == 0 { return a }
    let shift = (a | b).trailingZeroBitCount
    var u = a >> a.trailingZeroBitCount
    var v = b
    repeat {
        v >>= v.trailingZeroBitCount
        if u > v { swap(&u, &v) }
        v -= u
    } while v != 0
    return u << shift
}

/// Floor division for signed integers (`a` may be negative, `b > 0`).
func floorDiv(_ a: Int128, _ b: Int128) -> Int128 {
    let q = a / b
    return a < 0 && q * b != a ? q - 1 : q
}

/// Non-negative remainder (`b > 0`), the library's `modulo`.
func floorMod(_ a: Int, _ b: Int) -> Int {
    let r = a % b
    return r < 0 ? r + b : r
}

/// Non-negative remainder (`b > 0`) on 128 bits.
func floorMod(_ a: Int128, _ b: Int128) -> Int128 {
    let r = a % b
    return r < 0 ? r + b : r
}
