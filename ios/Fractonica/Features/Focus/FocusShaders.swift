/// The Metal shaders of Focus, compiled at run time (`MTLDevice.makeLibrary(source:options:)`) on first use.
///
/// They live in Swift source rather than a .metal file because the build machines have no offline Metal toolchain
/// (Xcode 26+ ships it as a separate download); the runtime compiler is part of Metal itself on every device and
/// simulator. `FocusPipelines` builds them off the main thread, once per process.
///
/// The picture is linear light written to an sRGB target (blending happens in linear space), soft-clipped and
/// dithered. Coordinates: the shorter side of the view spans −1 … 1, y up. The layouts match `FocusUniforms` and
/// `FocusGPULevel` in FocusRenderer.swift. Level i is depth i + 1: δ 3, ε 4, ζ 5, η 6, θ 7, ι 8, κ 9, λ 10, μ 11,
/// ν 12, and the sub-Blink ξ ο π 13 … 15.
enum FocusShaders {
    static let source = #"""
#include <metal_stdlib>
using namespace metal;

struct Header {
    float4 view;    // width px, height px, px per point, min(width, height) px
    float4 clock;   // drift s, breath 0…1, breath cue 0…1, calm 0…1
    float4 style;   // style A, style B, mix A→B 0…1, alive 0…1
    float4 extra;   // shimmer 0…1, dim 0…1, frame seed, exposure
    float4 lines;   // segments, width pt, alpha, unused
    float4 ground;  // background rgb (linear), unused
    float4 accent;  // the app's accent (teal), linear rgb, unused
};

struct Level {
    float4 motion;  // phase 0…1, amplitude 0…1, ripple 0…1, ripple age s
    float4 color;   // linear rgb, weight
    float4 info;    // siblings, factor, unused, unused
};

constant float TAU = 6.283185307;

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

static float3 encodeSRGB(float3 c) {
    c = max(c, 0.0);
    return select(1.055 * pow(c, 1.0 / 2.4) - 0.055, c * 12.92, c < 0.0031308);
}

static float3 decodeSRGB(float3 c) {
    c = max(c, 0.0);
    return select(pow((c + 0.055) / 1.055, 2.4), c / 12.92, c < 0.04045);
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
    float2 cell = floor(px * 0.5);
    float g = 0.0;
    for (int k = 13; k <= 15; k++) {
        float h = hash12(cell + float(k) * 17.3);
        g += cos(TAU * (phaseOf(L, k) + h));
    }
    return 1.0 + 0.07 * s * g / 3.0;
}

// ---------------------------------------------------------------- styles

/// 0 · Interference. Every level from ζ to ν sends a circular wave from a source near the centre that wanders with a
/// coarser level; the wave travels out one wavelength per cycle of its level and is shaped by an angular wave with as
/// many lobes as the level has siblings. Their sum is drawn as contour lines, like a map of the interference: each
/// line in the hue of the level its height corresponds to, coolest in the troughs, warmest on the crests. Broad glows
/// of α … ε drift the palette underneath.
static float3 interference(float2 p, float px, constant Header& H, constant Level* L) {
    float2 q = rotate(p, -TAU * phaseOf(L, 7));               // θ turns the whole pattern once per cycle
    float r = length(q);
    float3 col = 0.0;

    for (int i = 0; i <= 4; i++) {
        float place = TAU * (phaseOf(L, i) * 5.0 + float(i) * 0.27);
        float2 c = (0.45 + 0.08 * float(i)) * float2(cos(place), sin(place));
        float d = length(q - c);
        col += L[i].color.rgb * (0.040 * L[i].color.w * exp(-d * d * 2.4));
    }

    float sum = 0.0, total = 0.0;
    for (int i = 5; i <= 12; i++) {
        float amp = ampOf(L, i) * L[i].color.w;
        if (amp <= 0.001) { continue; }
        float place = TAU * phaseOf(L, i - 3) * (i % 2 == 0 ? 1.0 : -1.0) + float(i) * 2.39996;
        float2 src = (0.06 + 0.035 * float(i - 5)) * float2(cos(place), sin(place));
        float2 v = q - src;
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
static float2 pen(float s, constant Level* L, thread float4& weights);

static float3 harmonographGround(float2 p, float px, constant Header& H, constant Level* L) {
    float r = length(p);
    float3 col = 0.0;
    for (int i = 2; i <= 5; i++) {
        float place = TAU * (phaseOf(L, i - 2) * 3.0) + float(i) * 1.7;
        float2 c = 0.42 * float2(cos(place), sin(place));
        float d = length(p - c);
        col += L[i].color.rgb * (0.035 * exp(-d * d * 2.0));
    }
    float4 w;
    float2 tip = pen(0.0, L, w);
    float swell = 1.0 + 0.03 * (H.clock.y - 0.5) * H.clock.z * (1.0 - H.clock.w);
    float d = length(p - tip * swell);
    col += levelColor(L, 11.0) * (exp(-d * d / (px * px * 30.0)) * 1.4 + exp(-d / (px * 26.0)) * 0.10) * H.lines.z / 0.3;
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
        float R = R0 * (1.0 + 0.012 * sin(TAU * ph) * amp);
        float d = abs(r - R);
        float w = px * 0.85;
        float track = exp(-d * d / (w * w));
        float glow = exp(-d / (px * 5.0));
        float behind = fract(ph - f);                         // 0 at the head, growing backwards
        float tail = exp(-behind * (i >= 11 ? 9.0 : 4.5));
        float2 headPoint = R * float2(sin(TAU * ph), cos(TAU * ph));
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
    float raySlide = 0.025 * sin(TAU * phaseOf(L, 11)) * ampOf(L, 11) + 0.008 * sin(TAU * phaseOf(L, 12)) * ampOf(L, 12);
    float x = p.x;
    float spread = min(halfHeight, 1.9);
    for (int i = 3; i <= 12; i++) {
        float amp = ampOf(L, i);
        float k = float(i - 3) / 9.0;                          // 0 slow … 1 fast
        float slow = phaseOf(L, max(i - 2, 0));
        float base = mix(0.62, -0.50, k) * spread + 0.08 * sin(TAU * slow);
        float fold = vnoise(float2(x * 0.65 + slow * 5.0 + drift * 0.003, float(i) * 3.7)) * 0.75
                   + vnoise(float2(x * 1.7 - slow * 3.0, float(i) * 5.1 + 9.0)) * 0.25;
        float y0 = base + 0.55 * (fold - 0.5)
                 + 0.05 * sin(1.7 * x + TAU * phaseOf(L, i)) * amp
                 + 0.02 * sin(4.3 * x - TAU * phaseOf(L, min(i + 1, 12))) * ampOf(L, min(i + 1, 12));
        float dy = p.y - y0;
        float height = 0.07 + 0.12 * (1.0 - k);
        float reach = height * 9.0;
        if (dy < -0.05 || dy > reach) { continue; }
        float patch = smoothstep(0.42, 0.78, vnoise(float2(x * 0.8 - slow * 7.0 + float(i) * 11.0, float(i))));
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
    // Dither in the encoded domain: ±½ step of the 8-bit target.
    float n = hash12(pixel + H.extra.z * 7.13) - 0.5;
    return decodeSRGB(encodeSRGB(col) + n / 255.0);
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

    int a = int(H.style.x + 0.5);
    int b = int(H.style.y + 0.5);
    float m = H.style.z;
    float3 col = styleColor(a, q, px, H, L);
    if (m > 0.001 && b != a) {
        col = mix(col, styleColor(b, q, px, H, L), m);
    }
    col *= shimmer(pixel, H, L);
    col += ripples(r, px, L) * (1.0 - H.clock.w);
    col += breathHalo(r, px, H);

    // Outside the catalogue nothing is read: a still, colourless ember.
    float alive = H.style.w;
    if (alive < 1.0) {
        float ember = exp(-r * r * 3.0) * 0.012 * (0.85 + 0.15 * sin(H.clock.x * 0.4));
        col = mix(float3(ember), col, alive);
    }
    return float4(finish(col, pixel, H), 1.0);
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
