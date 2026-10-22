/// The Metal shaders of Focus, compiled at run time (`MTLDevice.makeLibrary(source:options:)`) on first use.
///
/// They live in Swift source rather than a .metal file because the build machines have no offline Metal toolchain
/// (Xcode 26+ ships it as a separate download); the runtime compiler is part of Metal itself on every device and
/// simulator. `FocusPipelines` builds them off the main thread, once per process.
///
/// The picture is linear light written to an sRGB target (blending happens in linear space), soft-clipped and
/// dithered. The field's fragment function is specialised per style with a function constant: one pipeline that
/// switched between the four styles at run time cost ten to thirty times as much GPU time per pixel (the register
/// budget of the heaviest style held back every other), so a style cross-fade draws two passes instead. Coordinates: the shorter side of the view spans −1 … 1, y up. The layouts match `FocusUniforms` and
/// `FocusGPULevel` in FocusRenderer.swift. Level i is depth i + 1: δ 3, ε 4, ζ 5, η 6, θ 7, ι 8, κ 9, λ 10, μ 11,
/// ν 12, and the sub-Blink ξ ο π 13 … 15.
enum FocusShaders {
    static let source = #"""
#include <metal_stdlib>
using namespace metal;

struct Header {
    float4 view;    // width px, height px, px per point, min(width, height) px
    float4 clock;   // drift s, breath 0…1, breath cue 0…1, calm 0…1
    float4 style;   // style A, style B, alpha of this pass (a cross-fade's second pass), alive 0…1
    float4 extra;   // shimmer 0…1, dim 0…1, frame seed, exposure
    float4 lines;   // segments, width pt, alpha, unused
    float4 ground;  // background rgb (linear), unused
    float4 accent;  // the app's accent (teal), linear rgb, unused
    float4 tip;     // the harmonograph pen's tip (field units), unused, unused
};

struct Level {
    float4 motion;  // phase 0…1, amplitude 0…1, ripple 0…1, ripple age s
    float4 color;   // linear rgb, weight
    float4 info;    // siblings, factor, unused, unused
    float4 trig;    // cos 2πφ, sin 2πφ, unused, unused (per frame, on the CPU: uniform for every pixel)
    float4 place;   // interference glow / source centre xy, harmonograph glow centre xy (per frame, on the CPU)
};

constant float TAU = 6.283185307;

/// The style a field pipeline draws (0 interference, 1 harmonograph, 2 rings, 3 aurora) and whether it blends over
/// the previous pass with the alpha in `style.z` (the second pass of a cross-fade).
constant int STYLE [[function_constant(0)]];
constant bool BLENDED [[function_constant(1)]];

// ---------------------------------------------------------------- helpers

static float hash12(float2 p) {
    float3 p3 = fract(float3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

static float vnoise(float2 p) {
    float2 i = floor(p);
    float2 f = fract(p);
    float2 u = f * f * (3.0 - 2.0 * f);
    float a = hash12(i);
    float b = hash12(i + float2(1.0, 0.0));
    float c = hash12(i + float2(0.0, 1.0));
    float d = hash12(i + float2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

static float2 rotate(float2 p, float a) {
    float c = cos(a), s = sin(a);
    return float2(c * p.x - s * p.y, s * p.x + c * p.y);
}

/// Rotates by the angle whose cosine and sine are `cs`.
static float2 rotateBy(float2 p, float2 cs) {
    return float2(cs.x * p.x - cs.y * p.y, cs.y * p.x + cs.x * p.y);
}

static float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

/// Value noise along a line (half the cost of `vnoise` where the second coordinate is constant).
static float vnoise1(float x, float seed) {
    float i = floor(x);
    float f = fract(x);
    float u = f * f * (3.0 - 2.0 * f);
    return mix(hash11(i + seed), hash11(i + 1.0 + seed), u);
}

static float phaseOf(constant Level* L, int i) { return L[i].motion.x; }
static float ampOf(constant Level* L, int i) { return L[i].motion.y; }

/// The colour between two levels, for gradients across the hierarchy (x in level units).
static float3 levelColor(constant Level* L, float x) {
    x = clamp(x, 0.0, 13.0);
    int i = int(floor(x));
    int j = min(i + 1, 13);
    return mix(L[i].color.rgb, L[j].color.rgb, x - float(i));
}

// ---------------------------------------------------------------- shared layers

/// Thin wavefronts leaving the centre when a level's cycle turns over; coarser boundaries ripple harder (several
/// levels turn over together at a coarse boundary, so their fronts add up).
static float3 ripples(float r, float px, constant Level* L) {
    float3 c = 0.0;
    for (int i = 3; i <= 12; i++) {
        float s = L[i].motion.z;
        if (s <= 0.0) { continue; }
        float age = L[i].motion.w;
        float radius = 0.04 + age * 0.55;
        float width = px * 1.5 + age * 0.006;
        float d = (r - radius) / width;
        c += L[i].color.rgb * (s * exp(-d * d) * 0.35);
    }
    return c;
}

/// The breathing cue: a soft light in the accent colour at the centre that swells while the Flavon rises and ebbs
/// while it falls.
static float3 breathHalo(float r, float px, constant Header& H) {
    float cue = H.clock.z;
    if (cue <= 0.0) { return 0.0; }
    float b = H.clock.y;
    float radius = 0.07 + 0.09 * b;
    float glow = exp(-(r * r) / (radius * radius));
    float3 tint = mix(H.accent.rgb, float3(0.85, 0.92, 1.0), 0.35);
    return tint * (glow * (0.018 + 0.040 * b) * cue);
}

/// The sub-Blink depths (ξ ο π) as a fine sparkle on whatever is lit: their phases move faster than any frame, so each
/// frame catches every pixel's grain at a different point of its cycle.
static float shimmer(float2 px, constant Header& H, constant Level* L) {
    float s = H.extra.x;
    if (s <= 0.0) { return 1.0; }
    float h = hash12(floor(px * 0.5));
    float g = cos(TAU * (phaseOf(L, 13) + h))
            + cos(TAU * (phaseOf(L, 14) + fract(h * 7.31)))
            + cos(TAU * (phaseOf(L, 15) + fract(h * 13.17)));
    return 1.0 + 0.07 * s * g / 3.0;
}

// ---------------------------------------------------------------- styles

/// 0 · Interference. Every level from ζ to ν sends a circular wave from a source near the centre that wanders with a
/// coarser level; the wave travels out one wavelength per cycle of its level and is shaped by an angular wave with as
/// many lobes as the level has siblings. Their sum is drawn as contour lines, like a map of the interference: each
/// line in the hue of the level its height corresponds to, coolest in the troughs, warmest on the crests. Broad glows
/// of α … ε drift the palette underneath.
static float3 interference(float2 p, float px, constant Header& H, constant Level* L) {
    float2 q = rotateBy(p, float2(L[7].trig.x, -L[7].trig.y)); // θ turns the whole pattern once per cycle
    float r = length(q);
    float3 col = 0.0;

    for (int i = 0; i <= 4; i++) {
        float d = length(q - L[i].place.xy);
        col += L[i].color.rgb * (0.040 * L[i].color.w * exp(-d * d * 2.4));
    }

    float sum = 0.0, total = 0.0;
    for (int i = 5; i <= 12; i++) {
        // The slow levels shape the contours; μ and ν, whose waves pass in a second or less, only stir them.
        float amp = ampOf(L, i) * L[i].color.w * (i == 12 ? 0.22 : (i == 11 ? 0.45 : 1.0));
        if (amp <= 0.001) { continue; }
        float2 v = q - L[i].place.xy;
        float d = length(v);
        float k = 5.0 + 1.6 * float(i - 5);
        float m = L[i].info.x;
        float spin = smoothstep(0.1, 0.7, d);
        float angular = 1.0 + 0.35 * spin * cos(m * atan2(v.y, v.x) + TAU * phaseOf(L, i - 1));
        sum += amp * cos(k * d - TAU * phaseOf(L, i)) * angular / (1.0 + 0.8 * d);
        total += amp;
    }
    float s = sum / max(total, 1e-3);                         // about −1 … 1
    float bands = 7.0;
    float v = s * bands;
    float w = max(fwidth(v), 1e-4);
    float d = abs(fract(v + 0.5) - 0.5) / w;                  // pixels to the nearest contour
    float line = 1.0 - smoothstep(0.6, 1.6, d);
    float glow = exp(-d * 0.18) * 0.10;
    float height = clamp(0.5 + floor(v + 0.5) / 7.0, 0.0, 1.0);
    float3 hue = levelColor(L, mix(2.0, 13.0, height));
    float fall = exp(-r * r * 0.30);
    col += hue * ((line * 0.85 + glow) * fall);
    return col;
}

/// 1 · Harmonograph: the trail is drawn by the line pipeline; underneath, a faint nebula in the slow levels'
/// colours and the pen's glowing tip.
static float3 harmonographGround(float2 p, float px, constant Header& H, constant Level* L) {
    float r = length(p);
    float3 col = 0.0;
    for (int i = 2; i <= 5; i++) {
        float d = length(p - L[i].place.zw);
        col += L[i].color.rgb * (0.035 * exp(-d * d * 2.0));
    }
    float2 tip = H.tip.xy;
    float swell = 1.0 + 0.03 * (H.clock.y - 0.5) * H.clock.z * (1.0 - H.clock.w);
    float d = length(p - tip * swell);
    col += levelColor(L, 11.0) * (exp(-d * d / (px * px * 30.0)) * 1.4 + exp(-d / (px * 26.0)) * 0.10);
    return col * exp(-r * r * 0.25);
}

/// 2 · Rings: one ring per level, δ outermost, ξ innermost. Each breathes with its own wave and carries its phase as
/// a comet running clockwise from the top; quarter ticks mark peak, node and valley; a ring flares as its cycle turns.
static float3 rings(float2 p, float px, constant Header& H, constant Level* L) {
    float r = length(p);
    float a = atan2(p.x, p.y);                                // 0 at the top, clockwise
    float f = fract(a / TAU + 1.0);
    float3 col = 0.0;
    for (int i = 3; i <= 13; i++) {
        float R0 = 0.20 + 0.066 * float(13 - i);
        if (abs(r - R0) > 0.06) { continue; }                  // nothing of this ring reaches here
        float amp = ampOf(L, i);
        float ph = phaseOf(L, i);
        float2 cs = L[i].trig.xy;                             // cos, sin of the phase angle
        float R = R0 * (1.0 + 0.012 * cs.y * amp);
        float d = abs(r - R);
        float w = px * 0.85;
        float track = exp(-d * d / (w * w));
        float glow = exp(-d / (px * 5.0));
        float behind = fract(ph - f);                         // 0 at the head, growing backwards
        float tail = exp(-behind * (i >= 11 ? 9.0 : 4.5));
        float2 headPoint = R * float2(cs.y, cs.x);
        float h = length(p - headPoint);
        float head = exp(-h * h / (px * px * 16.0)) * 1.6 + exp(-h / (px * 10.0)) * 0.25;
        float qf = fract(f * 4.0);
        float qd = min(qf, 1.0 - qf) * 0.25 * TAU * R;         // along the ring to the nearest quarter
        float tick = exp(-qd * qd / (px * px * 1.0)) * exp(-d * d / (px * px * 30.0));
        float flare = L[i].motion.z;
        float3 c = L[i].color.rgb;
        col += c * (track * (0.07 + 0.55 * tail * amp + 0.6 * flare) + glow * (0.02 + 0.10 * tail * amp + 0.15 * flare));
        col += c * (head * amp + tick * 0.09);
    }
    return col;
}

/// 3 · Aurora: a curtain per level, slow ones high and cool, fast ones low and warm. Each folds with its own and the
/// next level's wave, drifts and brightens in patches with a coarser one, and rises in rays that slide with the μ and
/// the ν.
static float3 aurora(float2 p, float px, constant Header& H, constant Level* L) {
    float halfHeight = H.view.y / H.view.w;
    float drift = H.clock.x;
    float3 col = 0.0;
    float raySlide = 0.025 * L[11].trig.y * ampOf(L, 11) + 0.008 * L[12].trig.y * ampOf(L, 12);
    float x = p.x;
    float spread = min(halfHeight, 1.9);
    // The swaying waves, sin(1.7x ± 2πφ) and sin(4.3x ± 2πφ), from these and each level's cos and sin.
    float s17 = sin(1.7 * x), c17 = cos(1.7 * x);
    float s43 = sin(4.3 * x), c43 = cos(4.3 * x);
    for (int i = 3; i <= 12; i++) {
        float amp = ampOf(L, i);
        float k = float(i - 3) / 9.0;                          // 0 slow … 1 fast
        float slow = phaseOf(L, max(i - 2, 0));
        int next = min(i + 1, 12);
        float base = mix(0.62, -0.50, k) * spread + 0.08 * L[max(i - 2, 0)].trig.y;
        float fold = vnoise1(x * 0.65 + slow * 5.0 + drift * 0.003, float(i) * 37.0) * 0.75
                   + vnoise1(x * 1.7 - slow * 3.0, float(i) * 53.0 + 9.0) * 0.25;
        float y0 = base + 0.55 * (fold - 0.5)
                 + 0.05 * (s17 * L[i].trig.x + c17 * L[i].trig.y) * amp
                 + 0.02 * (s43 * L[next].trig.x - c43 * L[next].trig.y) * ampOf(L, next);
        float dy = p.y - y0;
        float height = 0.07 + 0.12 * (1.0 - k);
        float reach = height * 9.0;
        if (dy < -0.05 || dy > reach) { continue; }
        float patch = smoothstep(0.36, 0.86, vnoise1(x * 0.8 - slow * 7.0 + float(i) * 11.0, float(i) * 71.0));
        if (patch <= 0.0) { continue; }
        float up = exp(-max(dy, 0.0) / height);
        float down = exp(min(dy, 0.0) / 0.008);
        float rays = vnoise(float2((x + raySlide) * 55.0 + float(i) * 13.0, dy * 1.2 - drift * 0.02));
        rays = rays * rays * (0.55 + 0.45 * vnoise(float2((x - raySlide) * 9.0, float(i) + dy * 0.5)));
        float tall = exp(-max(dy, 0.0) / (height * 3.0)) * down * rays * smoothstep(reach, reach * 0.5, dy);
        float edge = exp(-dy * dy / (0.00006 + px * px * 3.0));
        // Like a real aurora, each curtain cools as it rises: its own hue at the lower edge, a slower level's above.
        float3 c = mix(L[i].color.rgb, L[max(i - 3, 0)].color.rgb, smoothstep(0.0, height * 4.0, dy));
        col += c * (patch * (up * down * 0.28 + tall * 0.30 + edge * 0.30) * (0.6 + 0.4 * L[i].color.w));
    }
    return col;
}

static float3 styleColor(int style, float2 p, float px, constant Header& H, constant Level* L) {
    switch (style) {
        case 0: return interference(p, px, H, L);
        case 1: return harmonographGround(p, px, H, L);
        case 2: return rings(p, px, H, L);
        default: return aurora(p, px, H, L);
    }
}

// ---------------------------------------------------------------- the field pass

struct FieldOut {
    float4 position [[position]];
};

vertex FieldOut focusFieldVertex(uint vid [[vertex_id]]) {
    float2 uv = float2(float((vid << 1) & 2), float(vid & 2));
    FieldOut out;
    out.position = float4(uv * 2.0 - 1.0, 0.0, 1.0);
    return out;
}

/// The breathing cue's gentle zoom (none under Reduce Motion).
static float swellOf(constant Header& H) {
    return 1.0 + 0.03 * (H.clock.y - 0.5) * H.clock.z * (1.0 - H.clock.w);
}

static float3 finish(float3 col, float2 pixel, constant Header& H) {
    float luma = dot(col, float3(0.2126, 0.7152, 0.0722));
    col = max(luma + (col - luma) * 1.25, 0.0);               // a little more colour than the pastel inks
    col = 1.0 - exp(-col * H.extra.w);                       // soft clip
    col *= 1.0 - 0.45 * H.extra.y;                           // dim behind the overlay
    col += H.ground.rgb;
    // Dither: ±½ step of the 8-bit sRGB target, in linear light (d linear / d encoded ≈ 2.2 √linear).
    float n = hash12(pixel + H.extra.z * 7.13) - 0.5;
    return max(col + n * (2.2 / 255.0) * sqrt(max(col, 1e-5)), 0.0);
}

fragment float4 focusFieldFragment(FieldOut in [[stage_in]],
                                   constant Header& H [[buffer(0)]],
                                   constant Level* L [[buffer(1)]]) {
    float2 pixel = in.position.xy;
    float2 p = (pixel - 0.5 * H.view.xy) * (2.0 / H.view.w);
    p.y = -p.y;
    float r = length(p);
    float px = 2.0 / H.view.w;                               // one pixel in field units
    float2 q = p / swellOf(H);

    float3 col = styleColor(STYLE, q, px, H, L);              // STYLE is a constant: only that style is compiled
    col *= shimmer(pixel, H, L);
    col += ripples(r, px, L) * (1.0 - H.clock.w);
    col += breathHalo(r, px, H);

    // Outside the catalogue nothing is read: a still, colourless ember.
    float alive = H.style.w;
    if (alive < 1.0) {
        float ember = exp(-r * r * 3.0) * 0.012 * (0.85 + 0.15 * sin(H.clock.x * 0.4));
        col = mix(float3(ember), col, alive);
    }
    return float4(finish(col, pixel, H), BLENDED ? H.style.z : 1.0);
}

// ---------------------------------------------------------------- the harmonograph trail

struct LineOut {
    float4 position [[position]];
    float3 color;
    float edge;
    float alpha;
};

/// The pen of four damped pendulums near 2 : 3, detuned by ε and ζ, phased by η θ ι κ; λ and μ add a small rotary
/// pendulum and ζ turns the whole figure. `weights` says how much each pendulum moves the pen there.
static float2 pen(float s, constant Level* L, thread float4& weights) {
    float detune = 0.004 + 0.004 * sin(TAU * phaseOf(L, 4)) + 0.002 * cos(TAU * phaseOf(L, 5));
    float damp = exp(-0.0042 * s);
    float a1 = 0.44 * sin(2.0 * s + TAU * phaseOf(L, 6));
    float a2 = 0.28 * sin((3.0 + detune) * s + TAU * phaseOf(L, 8));
    float b1 = 0.44 * sin((3.0 - detune) * s + TAU * phaseOf(L, 7));
    float b2 = 0.28 * sin((2.0 + 0.5 * detune) * s + TAU * phaseOf(L, 9));
    float la = 0.09 * ampOf(L, 10);
    float mu = 0.035 * ampOf(L, 11);
    float rl = 5.0 * s + TAU * phaseOf(L, 10);
    float rm = 7.0 * s + TAU * phaseOf(L, 11);
    float2 pt = float2(a1 + a2 + la * sin(rl) + mu * sin(rm), b1 + b2 + la * cos(rl) + mu * cos(rm));
    weights = float4(abs(a1), abs(b1), abs(a2) + abs(b2), la + mu);
    return rotate(pt * damp * 1.12, TAU * phaseOf(L, 5));
}

vertex LineOut focusLineVertex(uint vid [[vertex_id]],
                               constant Header& H [[buffer(0)]],
                               constant Level* L [[buffer(1)]]) {
    float segments = H.lines.x;
    float seg = float(vid >> 1);
    float side = (vid & 1) ? 1.0 : -1.0;
    float u = seg / segments;                                // 0 at the pen … 1 at the oldest trace
    float span = TAU * 22.0;
    float s = u * span;
    float ds = span / segments;
    float4 w;
    float4 unused;
    float2 p0 = pen(s - ds, L, unused);
    float2 p1 = pen(s, L, w);
    float2 p2 = pen(s + ds, L, unused);
    float2 t = p2 - p0;
    float len = max(length(t), 1e-6);
    float2 normal = float2(-t.y, t.x) / len;

    float2 fieldToNDC = float2(H.view.w / H.view.x, H.view.w / H.view.y);
    float halfWidth = H.lines.y * H.view.z / H.view.w * 1.5;     // field units, wider than drawn for the edge AA
    float2 q = (p1 * swellOf(H) + normal * side * halfWidth) * fieldToNDC;

    LineOut out;
    out.position = float4(q, 0.0, 1.0);
    // Time runs along the trail: the pen in the warm hues of the fast levels, the oldest trace in the cool slow ones;
    // the pendulum that moves the pen most tints it.
    float3 along = levelColor(L, 11.0 - 9.0 * pow(u, 0.7));
    float total = w.x + w.y + w.z + w.w + 1e-3;
    float3 pendulums = (L[6].color.rgb * w.x + L[7].color.rgb * w.y + L[8].color.rgb * w.z + L[10].color.rgb * w.w) / total;
    out.color = mix(along, pendulums, 0.3);
    out.edge = side;
    float fade = pow(1.0 - u, 1.4);
    out.alpha = H.lines.z * (0.10 + 0.90 * fade) * (1.0 - 0.45 * H.extra.y);
    return out;
}

fragment float4 focusLineFragment(LineOut in [[stage_in]]) {
    float e = abs(in.edge);
    float coverage = 1.0 - smoothstep(0.35, 1.0, e);
    return float4(in.color * (in.alpha * coverage), 0.0);
}
"""#
}
