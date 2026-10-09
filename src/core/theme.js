/**
 * Shared colours. Canvas/SVG code reads these constants; CSS uses the matching
 * custom properties in styles/app.css (keep the two in sync).
 */
export const TEAL = '#4FD1C5'; // period glyphs (SPEC §8)
export const GOLD = '#FFD60A'; // solar odometer (SPEC §8)
export const NOW = '#ff5d73'; // marker for the real "now" when travelling
export const CURSOR = '#8ab4ff'; // displayed time
export const INK = '#e7edf3';
export const INK_2 = '#a3b1bf';
export const INK_3 = '#7d8d9d';
export const LINE = '#1f2a36';
export const BG = '#07090d';
export const PANEL = '#10161d';

/** Hue per level: violet (alpha, longest) -> teal -> amber -> orange (finest). */
export function levelHue(level) {
  return Math.round(268 - Math.min(level, 13) * (238 / 13));
}
/** CSS colour for a level. `alpha` 0..1, `l` lightness override (default 64). */
export function levelColor(level, alpha = 1, l = 64) {
  return `hsl(${levelHue(level)} 68% ${l}% / ${alpha})`;
}

/** Style object for CBT glyph SVGs (library `toSVG(style)`), in a colour. */
export function glyphStyle(color = INK, scale = 10, extra = {}) {
  return { color, scale, thickness: 0.3, padding: 0.35, ...extra };
}
