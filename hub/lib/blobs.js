// Blob bytes on disk: <data>/blobs/aa/<sha256>, streamed in with the hash checked on the fly, and JPEG thumbnails made
// on demand (sips on macOS for images, ffmpeg for video and elsewhere) cached under <data>/thumbs/aa/<hash>-<px>.jpg.
import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync, readdirSync } from 'node:fs';
import { execFile, execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { tooLarge, unprocessable } from './util.js';

const which = (cmd) => {
  try {
    return execFileSync('/usr/bin/which', [cmd], { encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
};

export function openBlobs(dir, { maxSize = 4 * 1024 ** 3 } = {}) {
  const root = join(dir, 'blobs');
  const tmp = join(root, 'tmp');
  const thumbs = join(dir, 'thumbs');
  mkdirSync(tmp, { recursive: true });
  mkdirSync(thumbs, { recursive: true });
  for (const f of readdirSync(tmp)) rmSync(join(tmp, f), { force: true }); // partial uploads of a previous run

  const path = (hash) => join(root, hash.slice(0, 2), hash);
  const exists = (hash) => existsSync(path(hash));
  const tools = { sips: process.platform === 'darwin' ? which('sips') : null, ffmpeg: which('ffmpeg') };

  /**
   * Streams `body` to disk as blob `hash`. Resolves { created, size }; rejects 422 when the bytes do not hash to `hash`,
   * 413 above the size limit. A blob that is already stored is drained and kept.
   */
  async function put(hash, body, { length } = {}) {
    if (length !== undefined && length > maxSize) throw tooLarge(`blobs are limited to ${maxSize} bytes`);
    const file = join(tmp, `${hash}.${randomBytes(6).toString('hex')}`);
    const h = createHash('sha256');
    let size = 0;
    const meter = new Transform({
      transform(chunk, _enc, cb) {
        size += chunk.length;
        if (size > maxSize) return cb(tooLarge(`blobs are limited to ${maxSize} bytes`));
        h.update(chunk);
        cb(null, chunk);
      },
    });
    try {
      await pipeline(body, meter, createWriteStream(file));
    } catch (e) {
      rmSync(file, { force: true });
      throw e;
    }
    const got = h.digest('hex');
    if (got !== hash) {
      rmSync(file, { force: true });
      throw unprocessable('the bytes do not match the hash', { expected: hash, actual: got });
    }
    const had = exists(hash);
    if (had) rmSync(file, { force: true });
    else {
      mkdirSync(join(root, hash.slice(0, 2)), { recursive: true });
      renameSync(file, path(hash));
    }
    return { created: !had, size };
  }

  function remove(hash) {
    rmSync(path(hash), { force: true });
    const d = join(thumbs, hash.slice(0, 2));
    if (existsSync(d)) for (const f of readdirSync(d)) if (f.startsWith(hash)) rmSync(join(d, f), { force: true });
  }

  const run = (cmd, args) =>
    new Promise((resolve) => execFile(cmd, args, { timeout: 60000 }, (err) => resolve(!err)));
  const making = new Map();

  /** A cached JPEG thumbnail whose long side is at most `px`, or null when none can be made. */
  async function thumb(hash, px, type = '') {
    const out = join(thumbs, hash.slice(0, 2), `${hash}-${px}.jpg`);
    if (existsSync(out)) return out;
    const key = `${hash}-${px}`;
    if (making.has(key)) return making.get(key);
    const job = (async () => {
      mkdirSync(join(thumbs, hash.slice(0, 2)), { recursive: true });
      const src = path(hash);
      const part = `${out}.${randomBytes(4).toString('hex')}.jpg`;
      let ok = false;
      if (type.startsWith('image/') && tools.sips) {
        ok = await run(tools.sips, ['-s', 'format', 'jpeg', '-s', 'formatOptions', '82', '-Z', String(px), src, '--out', part]);
      }
      if (!ok && tools.ffmpeg && (type.startsWith('image/') || type.startsWith('video/'))) {
        const scale = `scale='if(gt(iw,ih),min(${px},iw),-2)':'if(gt(iw,ih),-2,min(${px},ih))'`;
        ok = await run(tools.ffmpeg, ['-v', 'error', '-y', '-i', src, '-frames:v', '1', '-vf', scale, '-q:v', '3', '-f', 'image2', part]);
      }
      if (ok && existsSync(part) && statSync(part).size > 0) {
        renameSync(part, out);
        return out;
      }
      rmSync(part, { force: true });
      return null;
    })().finally(() => making.delete(key));
    making.set(key, job);
    return job;
  }

  return { path, exists, put, remove, thumb, tools, maxSize };
}
