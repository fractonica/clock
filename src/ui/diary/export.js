/**
 * Printing the diary: the complete print document (src/diary/render.js printDocument) goes into a hidden frame whose
 * print() opens the browser's print dialog ("Save as PDF" makes the PDF), or into a new tab ("Open print view").
 * Blob URLs keep a large document (hundreds of pages of SVG) out of attributes and are revoked when done.
 */

/** Pages and paper of a print document, read back from its HTML (top-level SVGs and the @page rule). */
export function inspectPrintDocument(html) {
  const size = /@page\s*\{[^}]*?size:\s*([\d.]+)mm\s+([\d.]+)mm/.exec(html);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const pages = [...doc.querySelectorAll('svg')].filter((s) => !s.parentElement?.closest('svg')).length;
  return { pages, width: size ? Number(size[1]) : null, height: size ? Number(size[2]) : null, title: doc.title };
}

let frame = null;
let frameUrl = null;
function dropFrame() {
  frame?.remove();
  frame = null;
  if (frameUrl) URL.revokeObjectURL(frameUrl);
  frameUrl = null;
}

/**
 * Print `html` from a hidden frame. Resolves once the dialog was asked for (or rejects when the frame cannot load).
 * The frame stays until the dialog closes (afterprint), ten minutes at most, then it is removed.
 */
export function printHtml(html) {
  dropFrame();
  frameUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const f = document.createElement('iframe');
  f.className = 'dy-printframe';
  f.setAttribute('aria-hidden', 'true');
  f.tabIndex = -1;
  f.title = 'Diary print document';
  frame = f;
  return new Promise((resolve, reject) => {
    const fail = setTimeout(() => reject(new Error('the print document did not load')), 60000);
    f.addEventListener(
      'load',
      () => {
        clearTimeout(fail);
        const w = f.contentWindow;
        if (!w) return reject(new Error('the print frame is not available'));
        const done = () => setTimeout(() => frame === f && dropFrame(), 1000);
        w.addEventListener('afterprint', done, { once: true });
        setTimeout(() => frame === f && dropFrame(), 10 * 60 * 1000);
        try {
          w.focus();
          w.print();
          resolve(f);
        } catch (err) {
          reject(err);
        }
      },
      { once: true },
    );
    f.src = frameUrl;
    document.body.append(f);
  });
}

/** The print document in a new tab (the reader prints from there). Returns false when a popup blocker refused it. */
export function openHtml(html) {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const w = window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
  return !!w;
}

/** The current print frame (tests). */
export const currentFrame = () => frame;
