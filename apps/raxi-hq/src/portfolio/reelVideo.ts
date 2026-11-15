// Builds a vertical Reel video in the browser from archived photos (no upload, no provider, no cost).

export interface ReelFrame { url: string; seconds: number; text: string }

const FADE = 0.18; // seconds of crossfade between photos

/** Pure timeline: which photo is on screen at time t, how far into it, and the incoming crossfade. */
export function reelFrameAt(t: number, durations: number[]) {
  let start = 0;
  for (let i = 0; i < durations.length; i++) {
    const end = start + durations[i];
    if (t < end || i === durations.length - 1) {
      const local = Math.min(1, Math.max(0, (t - start) / durations[i]));
      const fadeIn = i > 0 ? Math.min(1, Math.max(0, (t - start) / FADE)) : 1;
      return { index: i, progress: local, fadeIn };
    }
    start = end;
  }
  return { index: 0, progress: 0, fadeIn: 1 };
}
export const reelDuration = (durations: number[]): number => durations.reduce((a, b) => a + b, 0);

/** Prefers MP4 (what Instagram accepts directly); falls back to WebM only if the browser can't record MP4. */
export function pickMime(isSupported: (m: string) => boolean): string | null {
  return ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find(isSupported) ?? null;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean); const lines: string[] = []; let line = '';
  for (const w of words) { const next = line ? `${line} ${w}` : w; if (ctx.measureText(next).width > maxWidth && line) { lines.push(line); line = w; } else line = next; }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, W: number, H: number, zoom: number) {
  const scale = Math.max(W / img.naturalWidth, H / img.naturalHeight) * zoom;
  const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
}

export async function buildReelVideo(frames: ReelFrame[], onProgress?: (p: number) => void): Promise<{ blob: Blob; mime: string }> {
  if (typeof MediaRecorder === 'undefined') throw new Error('Este navegador no puede grabar video.');
  const mime = pickMime((m) => MediaRecorder.isTypeSupported(m));
  if (!mime) throw new Error('Este navegador no puede grabar video.');
  const images = await Promise.all(frames.map((f) => new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img); img.onerror = () => reject(new Error('No se pudo cargar una foto.')); img.src = f.url;
  })));
  const W = 1080, H = 1920;
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const durations = frames.map((f) => Math.max(0.3, f.seconds));
  const total = reelDuration(durations);
  const draw = (t: number) => {
    const { index, progress, fadeIn } = reelFrameAt(t, durations);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    if (index > 0 && fadeIn < 1) { ctx.globalAlpha = 1; drawCover(ctx, images[index - 1], W, H, 1.06); }
    ctx.globalAlpha = fadeIn; drawCover(ctx, images[index], W, H, 1 + 0.06 * progress); ctx.globalAlpha = 1;
    const text = frames[index].text.trim();
    if (text) {
      ctx.font = '600 58px system-ui, -apple-system, Segoe UI, Roboto, sans-serif'; ctx.textAlign = 'center';
      const lines = wrap(ctx, text, W - 200); const y0 = H * 0.70;
      ctx.shadowColor = 'rgba(0,0,0,.75)'; ctx.shadowBlur = 18; ctx.fillStyle = '#fff';
      lines.forEach((l, k) => ctx.fillText(l, W / 2, y0 + k * 72));
      ctx.shadowBlur = 0;
    }
  };
  draw(0);
  const stream = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
  recorder.start(250);
  const t0 = performance.now();
  await new Promise<void>((resolve) => {
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      draw(Math.min(t, total)); onProgress?.(Math.min(1, t / total));
      if (t < total + 0.15) requestAnimationFrame(tick); else resolve();
    };
    requestAnimationFrame(tick);
  });
  recorder.stop(); await done;
  stream.getTracks().forEach((tr) => tr.stop());
  return { blob: new Blob(chunks, { type: mime.split(';')[0] }), mime: mime.split(';')[0] };
}
