// A timelapse's video from its frames, with ffmpeg: one video frame per Flavon from the first frame taken to the last,
// a missed Flavon holding the frame before it (so the video keeps the clock's time: at 30 fps a second is 30 Flavons),
// each frame stamped with its own reading of the clock (the date and the time down to the Flavon, as the app stamps
// its reels) and the Earth time; H.264 in MP4, and a poster from its middle.
import { execFile } from 'node:child_process';
import { mkdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
export const FFMPEG = process.env.FFMPEG || 'ffmpeg';

async function ffmpeg(args, cwd) {
  try {
    await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { cwd, maxBuffer: 16 << 20 });
  } catch (e) {
    const why = e.code === 'ENOENT' ? `no ${FFMPEG} (brew install ffmpeg)` : String(e.stderr || e.message).trim().split('\n').slice(-3).join(' ');
    throw new Error(`ffmpeg: ${why}`);
  }
}

/** "0:01:02.35": an ASS time, centiseconds. */
export function assTime(s) {
  const cs = Math.max(0, Math.round(s * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor(cs / 6000) % 60;
  const sec = Math.floor(cs / 100) % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

const assText = (s) => String(s).replace(/[{}\\]/g, '').replace(/\n/g, '\\N');

/**
 * The stamps as ASS subtitles: a run of video frames showing one source frame gets one event, from half a frame before
 * its first to half a frame after its last, so centisecond times never land on a frame's edge (up to 50 fps).
 * `runs`: [{ first, last, left, right }] (video frame indexes, the texts bottom left and bottom right).
 */
export function stampsAss(runs, { width, height, fps }) {
  const size = Math.max(12, Math.round(height * 0.042));
  const margin = Math.round(size * 0.7);
  const outline = Math.max(1, Math.round(size / 12));
  const at = (k) => (k <= 0 ? 0 : (k - 0.5) / fps);
  const lines = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${width}`, `PlayResY: ${height}`, 'WrapStyle: 2', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Stamp,Menlo,${size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H90000000,0,0,0,0,100,100,0,0,1,${outline},${outline},1,${margin},${margin},${margin},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  for (const r of runs) {
    const span = `${assTime(at(r.first))},${assTime((r.last + 0.5) / fps)}`;
    if (r.left) lines.push(`Dialogue: 0,${span},Stamp,,0,0,0,,${assText(r.left)}`);
    if (r.right) lines.push(`Dialogue: 0,${span},Stamp,,0,0,0,,{\\an3}${assText(r.right)}`);
  }
  return `${lines.join('\n')}\n`;
}

/** The size most frames have (a live view's frames may differ from the snaps'); even, as H.264 wants. */
export function frameSize(frames) {
  const counts = new Map();
  for (const f of frames) {
    const k = `${f.width}x${f.height}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const [w, h] = [...counts].sort((a, b) => b[1] - a[1])[0][0].split('x').map(Number);
  return { width: w - (w % 2), height: h - (h % 2) };
}

/**
 * Makes `<dir>/timelapse.mp4` and `<dir>/poster.jpg`.
 * @param {{n:number, file:string, width:number, height:number}[]} frames  the frames taken, by Flavon number
 * @param {(n:number) => {left?:string, right?:string}} [stamp]  the words on Flavon n's frame (none: no stamps)
 * → { video, poster, width, height, duration, frames (video frames), shown (frames taken) }
 */
export async function makeVideo({ frames, dir, fps = 30, stamp = null }) {
  const taken = [...frames].sort((a, b) => a.n - b.n);
  if (!taken.length) throw new Error('no frames');
  const { width, height } = frameSize(taken);
  const work = join(dir, 'video.tmp');
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  try {
    // a frame of another size is scaled once; every Flavon from the first to the last links to its frame
    const source = new Map();
    for (const f of taken) {
      if (f.width === width && f.height === height) source.set(f.n, f.file);
      else {
        const scaled = join(work, `scaled-${f.n}.jpg`);
        await ffmpeg(['-i', f.file, '-vf', `scale=${width}:${height}`, '-q:v', '2', scaled], work);
        source.set(f.n, scaled);
      }
    }
    const first = taken[0].n;
    const last = taken.at(-1).n;
    const runs = [];
    let j = 0;
    for (let n = first, k = 0; n <= last; n++, k++) {
      while (j + 1 < taken.length && taken[j + 1].n <= n) j++;
      const f = taken[j];
      symlinkSync(source.get(f.n), join(work, `${String(k).padStart(6, '0')}.jpg`));
      if (runs.at(-1)?.n === f.n) runs.at(-1).last = k;
      else runs.push({ n: f.n, first: k, last: k });
    }
    const count = last - first + 1;
    const filters = [];
    if (stamp) {
      writeFileSync(join(work, 'stamps.ass'), stampsAss(runs.map((r) => ({ ...r, ...stamp(r.n) })), { width, height, fps }));
      filters.push('ass=stamps.ass');
    }
    filters.push('scale=out_range=tv', 'format=yuv420p');
    const video = join(dir, 'timelapse.mp4');
    await ffmpeg(['-framerate', String(fps), '-i', '%06d.jpg', '-vf', filters.join(','), '-c:v', 'libx264', '-preset', 'medium',
      '-crf', '20', '-movflags', '+faststart', '-tag:v', 'avc1', video], work);
    const duration = count / fps;
    const poster = join(dir, 'poster.jpg');
    await ffmpeg(['-ss', (Math.floor(count / 2) / fps).toFixed(4), '-i', video, '-frames:v', '1', '-q:v', '2', poster], work);
    statSync(poster);
    return { video, poster, width, height, duration, frames: count, shown: taken.length };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
