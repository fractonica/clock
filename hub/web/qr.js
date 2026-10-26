// A small QR code encoder (byte mode, error correction M, versions 1–10: up to 213 bytes), enough for pairing links.
// Written for the hub after ISO/IEC 18004; runs in the browser and in Node. qrSVG() for the web UI, qrText() for a
// terminal.

// [ec codewords per block, [blocks, data codewords] …] for level M
const BLOCKS_M = [
  null,
  [10, [1, 16]], [16, [1, 28]], [26, [1, 44]], [18, [2, 32]], [24, [2, 43]],
  [16, [4, 27]], [18, [4, 31]], [22, [2, 38], [2, 39]], [22, [3, 36], [2, 37]], [26, [4, 43], [1, 44]],
];
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

// GF(256) with the QR polynomial 0x11d
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function rsGenerator(n) {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j];
      next[j + 1] ^= mul(g[j], EXP[i]);
    }
    g = next;
  }
  return g;
}
function rsRemainder(data, n) {
  const g = rsGenerator(n);
  const r = new Array(n).fill(0);
  for (const d of data) {
    const f = d ^ r.shift();
    r.push(0);
    for (let i = 0; i < n; i++) r[i] ^= mul(g[i + 1], f);
  }
  return r;
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function codewords(bytes, version) {
  const [ec, ...groups] = BLOCKS_M[version];
  const capacity = groups.reduce((s, [n, d]) => s + n * d, 0);
  const bits = [];
  const put = (v, n) => {
    for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, capacity * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; data.length < capacity; pad ^= 0xec ^ 0x11) data.push(pad);
  const blocks = [];
  let k = 0;
  for (const [n, d] of groups) {
    for (let i = 0; i < n; i++) {
      const block = data.slice(k, k + d);
      k += d;
      blocks.push({ data: block, ec: rsRemainder(block, ec) });
    }
  }
  const out = [];
  const maxD = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < maxD; i++) for (const b of blocks) if (i < b.data.length) out.push(b.data[i]);
  for (let i = 0; i < ec; i++) for (const b of blocks) out.push(b.ec[i]);
  return out;
}

/** Encodes `text` (UTF-8). Returns { size, modules: boolean[y][x] }, forcing `mask` (0–7) when given. */
export function qr(text, { mask: forced } = {}) {
  const bytes = new TextEncoder().encode(text);
  let version = 1;
  while (version <= 10) {
    const [, ...groups] = BLOCKS_M[version];
    const cap = groups.reduce((s, [n, d]) => s + n * d, 0);
    if (4 + (version < 10 ? 8 : 16) + bytes.length * 8 <= cap * 8) break;
    version++;
  }
  if (version > 10) throw new Error('text too long for a QR code here');
  const size = version * 4 + 17;
  const m = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => {
    m[y][x] = dark;
    fn[y][x] = true;
  };
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
  }
  const al = ALIGN[version];
  for (let i = 0; i < al.length; i++)
    for (let j = 0; j < al.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  const drawFormat = (mask) => {
    const data = (0 << 3) | mask; // level M = 00
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i) => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  drawFormat(0); // reserve the format areas
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, dark);
      set(b, a, dark);
    }
  }
  const data = codewords(bytes, version);
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const up = ((right + 1) & 2) === 0;
        const y = up ? size - 1 - vert : vert;
        if (!fn[y][x]) {
          m[y][x] = i < data.length * 8 && ((data[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
      }
  }
  const apply = (mask) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[mask](x, y)) m[y][x] = !m[y][x];
  };
  let best = forced;
  if (best === undefined) {
    let low = Infinity;
    for (let k = 0; k < 8; k++) {
      apply(k);
      drawFormat(k);
      const p = penalty(m, size);
      if (p < low) (low = p), (best = k);
      apply(k);
    }
  }
  apply(best);
  drawFormat(best);
  return { size, version, mask: best, modules: m };
}

function penalty(m, size) {
  let p = 0;
  const line = (get) => {
    let run = 1;
    let s = 0;
    const seq = [];
    for (let i = 0; i < size; i++) seq.push(get(i));
    for (let i = 1; i <= size; i++) {
      if (i < size && seq[i] === seq[i - 1]) run++;
      else {
        if (run >= 5) s += run - 2;
        run = 1;
      }
    }
    const str = seq.map((b) => (b ? 1 : 0)).join('');
    for (const pat of ['10111010000', '00001011101']) for (let k = str.indexOf(pat); k !== -1; k = str.indexOf(pat, k + 1)) s += 40;
    return s;
  };
  for (let y = 0; y < size; y++) p += line((x) => m[y][x]);
  for (let x = 0; x < size; x++) p += line((y) => m[y][x]);
  let dark = 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      if (m[y][x]) dark++;
      if (x < size - 1 && y < size - 1 && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
    }
  p += Math.floor(Math.abs((dark * 20) / (size * size) - 10)) * 10;
  return p;
}

/** An SVG of the code with a 4-module quiet zone (dark modules use currentColor unless `fg` is given). */
export function qrSVG(text, { fg = 'currentColor', bg = 'none' } = {}) {
  const { size, modules } = qr(text);
  const n = size + 8;
  let d = '';
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (modules[y][x]) d += `M${x + 4} ${y + 4}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="${bg}"/><path d="${d}" fill="${fg}"/></svg>`;
}

/** The code as text for a terminal: two module rows per line with half blocks, dark on light. */
export function qrText(text) {
  const { size, modules } = qr(text);
  const at = (x, y) => x >= 0 && y >= 0 && x < size && y < size && modules[y][x];
  const lines = [];
  for (let y = -2; y < size + 2; y += 2) {
    let s = '';
    for (let x = -2; x < size + 2; x++) {
      const top = at(x, y);
      const bottom = at(x, y + 1);
      s += top && bottom ? ' ' : top ? '▄' : bottom ? '▀' : '█';
    }
    lines.push(s);
  }
  return lines.join('\n');
}
