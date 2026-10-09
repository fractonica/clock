/**
 * Crisp HiDPI canvases that follow their CSS size. `view.begin()` returns a 2D context already scaled
 * to CSS pixels and the size to draw in; the backing store is resized only when the box changes.
 */
export function createCanvasView(canvas) {
  let w = 0;
  let h = 0;
  let dpr = 1;
  let g = null;
  let stale = true; // nothing drawn yet, or resized (resizing clears the bitmap)
  const measure = () => {
    const r = canvas.getBoundingClientRect();
    w = Math.max(1, Math.round(r.width));
    h = Math.max(1, Math.round(r.height));
    dpr = Math.min(3, globalThis.devicePixelRatio || 1);
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
      stale = true;
    }
    g = canvas.getContext('2d');
  };
  measure();
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
  ro?.observe(canvas);
  return {
    /** @returns {{g: CanvasRenderingContext2D, w: number, h: number, dpr: number}} */
    begin() {
      if (!g || !ro) measure();
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      stale = false;
      return { g, w, h, dpr };
    },
    get stale() {
      return stale;
    },
    get visible() {
      return w > 2 && h > 2;
    },
    destroy: () => ro?.disconnect(),
  };
}

/** Read a CSS custom property (colour) once. */
export function cssVar(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}
