// Canvas helpers that run in the browser: resize the seller's photo, crop shots to shape,
// draw headlines, and cut the real product out with a SAM mask. Nothing here needs a server.
import type { Aspect, Mask } from '../types';

/** The seller's photo. `url` is what the API sees; `hires` is what the real-product cutout is made from. */
export interface Photo {
  url: string;
  width: number;
  height: number;
  hires: string;
  /** hires pixels per `url` pixel */
  scale: number;
}

const API_SIDE = 1024;
const HIRES_SIDE = 2048;
const RATIO: Record<Aspect, number> = { '1:1': 1, '4:5': 4 / 5, '9:16': 9 / 16 };

function canvas(width: number, height: number) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('This browser cannot draw images.');
  return { c, ctx };
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That image could not be opened.'));
    img.src = url;
  });
}

export async function loadPhoto(file: File): Promise<Photo> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => {
    throw new Error('That file is not a photo this browser can open. Try a JPEG or PNG.');
  });
  const draw = (side: number, quality: number) => {
    const k = Math.min(1, side / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * k);
    const h = Math.round(bmp.height * k);
    const { c, ctx } = canvas(w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    return { url: c.toDataURL('image/jpeg', quality), width: w, height: h };
  };
  const api = draw(API_SIDE, 0.88);
  const hires = draw(HIRES_SIDE, 0.92);
  bmp.close();
  return { ...api, hires: hires.url, scale: hires.width / api.width };
}

function drawHeadline(ctx: CanvasRenderingContext2D, w: number, h: number, text: string) {
  const size = Math.round(w * 0.085);
  ctx.font = `800 ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const maxWidth = w * 0.84;
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  const top = h * 0.06;
  const lineHeight = size * 1.15;
  const bottom = top + lines.length * lineHeight;
  const fade = ctx.createLinearGradient(0, 0, 0, bottom + size);
  fade.addColorStop(0, 'rgba(0,0,0,0.5)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, w, bottom + size);
  ctx.fillStyle = '#fff';
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = size * 0.2;
  lines.forEach((l, i) => ctx.fillText(l, w / 2, top + i * lineHeight));
  ctx.shadowBlur = 0;
}

/** Centre-crops a generated image to the shot's shape and draws the headline on it, if there is one. */
export async function fitShot(url: string, aspect: Aspect, headline = ''): Promise<string> {
  const img = await loadImage(url);
  const r = RATIO[aspect];
  let sw = img.naturalWidth;
  let sh = img.naturalHeight;
  if (sw / sh > r) sw = Math.round(sh * r);
  else sh = Math.round(sw / r);
  const { c, ctx } = canvas(sw, sh);
  ctx.drawImage(img, Math.round((img.naturalWidth - sw) / 2), Math.round((img.naturalHeight - sh) / 2), sw, sh, 0, 0, sw, sh);
  if (headline) drawHeadline(ctx, sw, sh, headline);
  return c.toDataURL('image/jpeg', 0.92);
}

function unpack(mask: Mask) {
  const bin = atob(mask.bits);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return (i: number) => (bytes[i >> 3] & (0x80 >> (i & 7))) !== 0;
}

/** The product cut out of the seller's photo with transparent surroundings, cropped to the mask's box. */
export async function cutout(photo: Photo, mask: Mask): Promise<HTMLCanvasElement> {
  const img = await loadImage(photo.hires);
  const on = unpack(mask);
  const m = canvas(mask.width, mask.height);
  const px = m.ctx.createImageData(mask.width, mask.height);
  for (let i = 0; i < mask.width * mask.height; i++) if (on(i)) px.data[i * 4 + 3] = 255;
  m.ctx.putImageData(px, 0, 0);
  const k = photo.scale;
  const w = Math.round(mask.width * k);
  const h = Math.round(mask.height * k);
  const out = canvas(w, h);
  out.ctx.drawImage(img, mask.left * k, mask.top * k, mask.width * k, mask.height * k, 0, 0, w, h);
  out.ctx.globalCompositeOperation = 'destination-in';
  out.ctx.imageSmoothingQuality = 'high';
  out.ctx.drawImage(m.c, 0, 0, w, h);
  return out.c;
}

/** The marketplace main image: the real product, centred on pure white with a soft shadow. */
export function onWhite(cut: HTMLCanvasElement, side = 1600, fill = 0.82): string {
  const { c, ctx } = canvas(side, side);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, side, side);
  const k = Math.min((side * fill) / cut.width, (side * fill) / cut.height);
  const w = cut.width * k;
  const h = cut.height * k;
  ctx.shadowColor = 'rgba(0,0,0,0.16)';
  ctx.shadowBlur = side * 0.03;
  ctx.shadowOffsetY = side * 0.012;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cut, (side - w) / 2, (side - h) / 2, w, h);
  return c.toDataURL('image/jpeg', 0.93);
}

/** Paints a mask as a translucent overlay on a canvas the size of the photo. */
export function paintMask(target: HTMLCanvasElement, mask: Mask | null) {
  const ctx = target.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, target.width, target.height);
  if (!mask) return;
  const on = unpack(mask);
  const px = ctx.createImageData(mask.width, mask.height);
  for (let i = 0; i < mask.width * mask.height; i++) {
    if (on(i)) {
      px.data[i * 4] = 70;
      px.data[i * 4 + 1] = 170;
      px.data[i * 4 + 2] = 90;
      px.data[i * 4 + 3] = 140;
    }
  }
  ctx.putImageData(px, mask.left, mask.top);
}
