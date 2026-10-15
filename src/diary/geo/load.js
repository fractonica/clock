/**
 * Loads a data file that sits next to this module (src/diary/geo/data/…): with fetch in the browser, from the file
 * system in Node (tests, the PDF export), so the same code serves both.
 */
const NODE = !!globalThis.process?.versions?.node;

/** The bytes of `data/<name>` as a Uint8Array. */
export async function loadBytes(name) {
  const url = new URL(`./data/${name}`, import.meta.url);
  if (NODE && url.protocol === 'file:') {
    const { readFile } = await import('node:fs/promises');
    const buf = await readFile(url);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** `data/<name>` parsed as JSON. */
export async function loadJson(name) {
  return JSON.parse(new TextDecoder().decode(await loadBytes(name)));
}
