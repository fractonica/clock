// A camera on the Fractonica hardware hub (~/projects/fractonica-hardware: `fr camera …`, docs/design/camera-c1.md),
// one frame at a time. A frame is a `camera_snap` (REST, POST /api/v1/op/camera_snap: a one-frame stream to the Mac,
// 150–250 ms). The camera runs one stream at a time, so a snap is DEVICE_BUSY while another runs: a live view (web/cam,
// say) gives the next frame of its stream, joined on /app/stream with the hub's app token
// (~/.fractonica/secrets.json `app_token`, or FR_APP_TOKEN) and left at once; anything else (another program's snap
// at the same Flavon, a short recording) is waited out, the snap tried again every quarter second until the time is up.
import { copyFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

/** FR_HOME, where the hardware hub writes (and may only write) files. */
export const FR_HOME = process.env.FR_HOME || join(homedir(), '.fractonica');

export class CameraError extends Error {
  constructor(message, code = null) {
    super(message);
    this.code = code;
  }
}

/** The head of an mjpg1 block (camera-c1 D10): 24 bytes, integers little-endian, then the JPEG. */
export function parseJpegBlock(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (b.length < 24) throw new CameraError(`a frame block of ${b.length} B`);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const len = v.getUint32(20, true);
  const jpeg = b.subarray(24, 24 + len);
  if (24 + len !== b.length || jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg[len - 2] !== 0xff || jpeg[len - 1] !== 0xd9) {
    throw new CameraError('a frame block that is no whole JPEG');
  }
  return { index: v.getUint32(4, true), width: v.getUint16(12, true), height: v.getUint16(14, true), jpeg };
}

export class FrCamera {
  /**
   * @param {object} o
   * @param {string} [o.api]       the hardware hub (http://127.0.0.1:7420; it answers loopback only)
   * @param {string} o.device      the camera: an alias (cam-esp32) or id
   * @param {string} [o.instance]  its fr.camera instance (default: its only one)
   * @param {string} [o.frameSize] qvga … uxga for snaps (default: the camera's own)
   */
  constructor({ api = 'http://127.0.0.1:7420', device, instance = null, frameSize = null, quality = null, flash = false,
    token = null, home = FR_HOME, timeout = 6000 } = {}) {
    this.api = api.replace(/\/+$/, '');
    this.device = device;
    this.instance = instance;
    this.frameSize = frameSize;
    this.quality = quality;
    this.flash = flash;
    this.token = token;
    this.home = home;
    this.timeout = timeout;
  }

  async op(name, input, timeout = this.timeout) {
    let res;
    try {
      res = await fetch(`${this.api}/api/v1/op/${name}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Fr-Client': 'app' },
        body: JSON.stringify(input), signal: AbortSignal.timeout(timeout),
      });
    } catch (e) {
      throw new CameraError(`the hardware hub at ${this.api} did not answer (${e.cause?.code ?? e.cause?.message ?? e.message})`, 'HUB_DOWN');
    }
    const r = await res.json().catch(() => null);
    if (!r?.ok) throw new CameraError(r?.error?.message ?? `HTTP ${res.status}`, r?.error?.code ?? null);
    return r.data;
  }

  /** The camera's status (camera_status): properties and the stream that runs, if any. */
  status() {
    return this.op('camera_status', { device: this.device, ...(this.instance ? { instance: this.instance } : {}) });
  }

  /** One frame into `file` → { via: 'snap' | 'live', width, height, bytes }. */
  async capture(file) {
    const deadline = Date.now() + this.timeout;
    for (;;) {
      try {
        return await this.snap(file);
      } catch (e) {
        if (e.code !== 'DEVICE_BUSY') throw e;
      }
      try {
        return await this.live(file, Math.min(3000, Math.max(500, deadline - Date.now())));
      } catch (e) {
        if (e.code !== 'NOT_LIVE') throw e;
      }
      if (Date.now() > deadline - 400) throw new CameraError(`${this.device} stayed busy with another stream (not a live view)`, 'BUSY');
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  async snap(file) {
    // the hub writes under FR_HOME only: there first, then moved
    const dir = join(this.home, 'captures', this.device, 'timelapse');
    mkdirSync(dir, { recursive: true });
    const out = join(dir, `${process.pid}-${basename(file)}`);
    const job = await this.op('camera_snap', {
      device: this.device, out, wait_s: Math.ceil(this.timeout / 1000) - 1,
      ...(this.instance ? { instance: this.instance } : {}),
      ...(this.frameSize ? { frame_size: this.frameSize } : {}),
      ...(this.quality ? { quality: this.quality } : {}),
      ...(this.flash ? { flash: true } : {}),
    }, this.timeout + 2000);
    if (job.status !== 'completed' || !job.result?.path) {
      throw new CameraError(job.error?.message ?? `the snap ended ${job.status}`, job.error?.code ?? null);
    }
    move(job.result.path, file);
    return { via: 'snap', width: job.result.width, height: job.result.height, bytes: job.result.bytes };
  }

  appToken() {
    if (this.token) return this.token;
    if (process.env.FR_APP_TOKEN) return process.env.FR_APP_TOKEN;
    try {
      const t = JSON.parse(readFileSync(join(this.home, 'secrets.json'), 'utf8')).app_token;
      if (typeof t === 'string' && t) return (this.token = t);
    } catch {
      // never pass the parse error on: it would quote the file
    }
    throw new CameraError(`the camera streams already, and no app token is there to join it (${join(this.home, 'secrets.json')} app_token, or FR_APP_TOKEN)`, 'NO_TOKEN');
  }

  /** The next frame of the live stream running on the camera; NOT_LIVE (at once) when what runs is not live. */
  live(file, timeout = this.timeout) {
    const token = this.appToken();
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${this.api.replace(/^http/, 'ws')}/app/stream`);
      ws.binaryType = 'arraybuffer';
      let done = false;
      let streaming = false;
      const finish = (err, value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try {
          ws.close();
        } catch {}
        if (err) reject(err);
        else resolve(value);
      };
      const timer = setTimeout(() => finish(new CameraError(streaming
        ? 'the camera streams, but no frame came in time'
        : 'the camera streams, but not live: no frame to take', streaming ? 'BUSY' : 'NOT_LIVE')), timeout);
      ws.onopen = () => ws.send(JSON.stringify({ t: 'stream.hello', v: 1, token, device: this.device, ...(this.instance ? { instance: this.instance } : {}) }));
      ws.onmessage = (e) => {
        if (typeof e.data === 'string') {
          let f;
          try {
            f = JSON.parse(e.data);
          } catch {
            return;
          }
          // nothing live to join (another's snap, which is never live, or a stream that has ended): snap again
          if (f.t === 'stream.started') streaming = true;
          else if (f.t === 'stream.welcome') {
            if (f.stream) streaming = true;
            else finish(new CameraError('no live stream to join', 'NOT_LIVE'));
          } else if (f.t === 'stream.ended') finish(new CameraError('the live stream ended', 'NOT_LIVE'));
          else if (f.t === 'error') {
            finish(f.code === 'DEVICE_BUSY' ? new CameraError('the camera streams, but not live', 'NOT_LIVE') : new CameraError(f.message ?? 'the live stream refused', f.code ?? null));
          } else if (f.t === 'ping') ws.send(JSON.stringify({ t: 'pong', id: f.id }));
          return;
        }
        try {
          const b = parseJpegBlock(e.data);
          writeFileSync(file, b.jpeg);
          finish(null, { via: 'live', width: b.width, height: b.height, bytes: b.jpeg.length });
        } catch (x) {
          finish(x);
        }
      };
      ws.onerror = () => finish(new CameraError(`the hardware hub's live stream at ${this.api} did not answer`, 'HUB_DOWN'));
      ws.onclose = (e) => finish(new CameraError(e.code === 4401 ? 'the app token was refused' : `the live stream closed (${e.code}${e.reason ? ` ${e.reason}` : ''})`, 'CLOSED'));
    });
  }
}

function move(from, to) {
  try {
    renameSync(from, to);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    copyFileSync(from, to);
    rmSync(from, { force: true });
  }
}
