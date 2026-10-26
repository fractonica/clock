// Record validation, the canonical form used for last-writer-wins ties, and the searchable text of each kind.
import { bad, tooLarge, isObj, canonicalJSON, sha256 } from './util.js';

export const ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
export const KIND_RE = /^[a-z0-9]+(\.[a-z0-9_-]+)+$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const MAX_DATA = 1024 * 1024;
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const str = (v) => typeof v === 'string' && v.trim() !== '';

const BLOB_KEYS = ['hash', 'type', 'size', 'role', 'name', 'width', 'height', 'duration', 'poster'];

function normBlob(b, i) {
  if (!isObj(b)) throw bad(`blobs[${i}] must be an object`);
  const hash = String(b.hash ?? '').toLowerCase();
  if (!HASH_RE.test(hash)) throw bad(`blobs[${i}].hash must be a lowercase hex SHA-256`);
  if (typeof b.type !== 'string' || !b.type) throw bad(`blobs[${i}].type is required`);
  if (!Number.isInteger(b.size) || b.size < 0) throw bad(`blobs[${i}].size must be a byte count`);
  if (typeof b.role !== 'string' || !b.role) throw bad(`blobs[${i}].role is required`);
  const out = { hash, type: b.type, size: b.size, role: b.role };
  if (typeof b.name === 'string') out.name = b.name;
  for (const k of ['width', 'height']) if (Number.isInteger(b[k])) out[k] = b[k];
  if (fin(b.duration)) out.duration = b.duration;
  if (typeof b.poster === 'string' && HASH_RE.test(b.poster.toLowerCase())) out.poster = b.poster.toLowerCase();
  return Object.fromEntries(BLOB_KEYS.filter((k) => k in out).map((k) => [k, out[k]]));
}

/**
 * The written fields of an incoming record, validated and normalised: absent optional fields become null / [] / false,
 * unknown fields are dropped, a tombstone carries no data, text, tags or blobs.
 */
export function normalizeRecord(id, b) {
  if (!ID_RE.test(id ?? '')) throw bad('id must match [A-Za-z0-9._:-]{1,128}');
  if (!isObj(b)) throw bad('the record must be a JSON object');
  if (b.id !== undefined && b.id !== id) throw bad('the id in the body differs from the id in the path');
  if (typeof b.kind !== 'string' || !KIND_RE.test(b.kind)) throw bad('kind must be dotted lowercase, like journal.entry');
  if (!fin(b.time)) throw bad('time must be Unix seconds');
  if (!fin(b.created)) throw bad('created must be Unix seconds');
  if (!fin(b.updated)) throw bad('updated must be Unix seconds');
  if (b.end !== undefined && b.end !== null && !fin(b.end)) throw bad('end must be Unix seconds or null');
  if (b.zone !== undefined && b.zone !== null && (typeof b.zone !== 'string' || b.zone.length > 64)) throw bad('zone must be an IANA zone name');
  const deleted = b.deleted === true;
  const r = {
    id,
    kind: b.kind,
    time: b.time,
    end: b.end ?? null,
    zone: b.zone ?? null,
    data: {},
    text: null,
    tags: [],
    blobs: [],
    created: b.created,
    updated: b.updated,
    deleted,
  };
  if (!deleted) {
    if (!isObj(b.data)) throw bad('data must be a JSON object');
    if (Buffer.byteLength(JSON.stringify(b.data)) > MAX_DATA) throw tooLarge('data is larger than 1 MB');
    r.data = b.data;
    if (b.text !== undefined && b.text !== null) {
      if (typeof b.text !== 'string') throw bad('text must be a string');
      r.text = b.text;
    }
    if (b.tags !== undefined && b.tags !== null) {
      if (!Array.isArray(b.tags) || b.tags.length > 256 || !b.tags.every((t) => typeof t === 'string' && t.length <= 128))
        throw bad('tags must be short strings');
      r.tags = b.tags;
    }
    if (b.blobs !== undefined && b.blobs !== null) {
      if (!Array.isArray(b.blobs) || b.blobs.length > 1000) throw bad('blobs must be a list');
      r.blobs = b.blobs.map(normBlob);
    }
  }
  return r;
}

/** SHA-256 of the canonical JSON of the written fields: equal content ⇔ equal hash; ties of `updated` go to the greater. */
export const contentHash = (r) =>
  sha256(
    canonicalJSON({
      id: r.id, kind: r.kind, time: r.time, end: r.end, zone: r.zone, data: r.data, text: r.text, tags: r.tags,
      blobs: r.blobs, created: r.created, updated: r.updated, deleted: r.deleted,
    }),
  );

/**
 * The searchable text of a record, as a title and a body (hub/API.md § Records):
 *   journal.entry   title = emoji + title, body = markdown (+ transcript)
 *   any other kind  title = data.emoji + data.title, body = text, else data.text, else data.summary
 */
export function searchable(r) {
  const d = isObj(r.data) ? r.data : {};
  if (r.kind === 'journal.entry') {
    return {
      title: [d.emoji, d.title].filter(str).join(' '),
      body: [d.markdown, d.transcript].filter(str).join('\n\n'),
    };
  }
  const body = [r.text, d.text, d.summary].find(str) ?? '';
  return { title: [d.emoji, d.title].filter(str).join(' '), body };
}

/** The roles the worker embeds on their own. */
export const MEDIA_ROLES = new Set(['photo', 'video', 'audio']);

/** What the worker embeds for a record: the composed text and the media list (empty text and no media: nothing). */
export function embeddingInput(r) {
  const { title, body } = searchable(r);
  // each video is followed by its poster (role "poster", `video` = the video's hash): a worker that cannot decode the
  // video embeds the poster as the video's `blob:<video hash>` part, else it drops the poster
  const media = [];
  for (const b of r.blobs ?? []) {
    if (!MEDIA_ROLES.has(b.role)) continue;
    const m = { hash: b.hash, type: b.type, role: b.role, url: `/v1/blobs/${b.hash}` };
    if (b.duration !== undefined) m.duration = b.duration;
    if (b.role === 'video' && b.poster) m.poster = b.poster;
    media.push(m);
    if (b.role === 'video' && b.poster) {
      const p = (r.blobs ?? []).find((x) => x.hash === b.poster);
      media.push({ hash: b.poster, type: p?.type ?? 'image/jpeg', role: 'poster', url: `/v1/blobs/${b.poster}`, video: b.hash });
    }
  }
  if (!title && !body && media.length === 0) return null;
  const text = title || body ? `title: ${title || 'none'} | text: ${body}` : '';
  return { text, media, sig: sha256(JSON.stringify([text, media.map((m) => m.hash)])) };
}
