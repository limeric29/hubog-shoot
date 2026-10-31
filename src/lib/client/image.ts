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

async function isHeifFile(file: File) {
  if (/heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)) return true;
  if (file.size < 12) return false;
  const brand = new TextDecoder().decode(await file.slice(8, 12).arrayBuffer()).trim().toLowerCase();
  return ['heic', 'heix', 'hevc', 'hevx', 'heif', 'mif1', 'msf1'].includes(brand);
}

function imageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image could not be decoded.'));
    };
    img.src = url;
  });
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
  let bmp: ImageBitmap | HTMLImageElement;
  try {
    if (typeof createImageBitmap !== 'function') throw new Error('ImageBitmap is not supported.');
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    if (await isHeifFile(file)) {
      try {
        // Load the WebAssembly decoder only when the browser cannot decode the HEIC itself.
        const { heicTo } = await import('heic-to');
        const jpeg = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.98 });
        bmp = await imageFromBlob(jpeg);
      } catch {
        throw new Error('This HEIC/HEIF photo could not be opened. Try sharing it as a JPEG from Photos.');
      }
    } else {
      try {
        // Older mobile browsers may not implement createImageBitmap for regular photos either.
        bmp = await imageFromBlob(file);
      } catch {
        throw new Error('This photo format could not be opened. Try a JPEG, PNG, or WebP.');
      }
    }
  }

  const sourceWidth = bmp instanceof HTMLImageElement ? bmp.naturalWidth : bmp.width;
  const sourceHeight = bmp instanceof HTMLImageElement ? bmp.naturalHeight : bmp.height;
  if (!sourceWidth || !sourceHeight) throw new Error('This photo has no readable image data. Try another photo.');
  const draw = (side: number, quality: number) => {
    const k = Math.min(1, side / Math.max(sourceWidth, sourceHeight));
    const w = Math.round(sourceWidth * k);
    const h = Math.round(sourceHeight * k);
    const { c, ctx } = canvas(w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    return { url: c.toDataURL('image/jpeg', quality), width: w, height: h };
  };
  try {
    const api = draw(API_SIDE, 0.88);
    const hires = draw(HIRES_SIDE, 0.92);
    return { ...api, hires: hires.url, scale: hires.width / api.width };
  } finally {
    if ('close' in bmp && typeof bmp.close === 'function') bmp.close();
  }
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

function cropTo(img: HTMLImageElement, aspect: Aspect) {
  const r = RATIO[aspect];
  let sw = img.naturalWidth;
  let sh = img.naturalHeight;
  if (sw / sh > r) sw = Math.round(sh * r);
  else sh = Math.round(sw / r);
  const { c, ctx } = canvas(sw, sh);
  ctx.drawImage(img, Math.round((img.naturalWidth - sw) / 2), Math.round((img.naturalHeight - sh) / 2), sw, sh, 0, 0, sw, sh);
  return { c, ctx, sw, sh };
}

/** Centre-crops a generated image to the shot's shape and draws the headline on it, if there is one. */
export async function fitShot(url: string, aspect: Aspect, headline = ''): Promise<string> {
  const { c, ctx, sw, sh } = cropTo(await loadImage(url), aspect);
  if (headline) drawHeadline(ctx, sw, sh, headline);
  return c.toDataURL('image/jpeg', 0.92);
}

/**
 * The fallback for a scene that keeps changing the product: the seller's real cutout placed on an
 * empty generated scene, with a contact shadow. `size` is the product's height as a share of the frame.
 */
export async function placeOnScene(sceneUrl: string, aspect: Aspect, cut: HTMLCanvasElement, headline: string, size: number): Promise<string> {
  const { c, ctx, sw, sh } = cropTo(await loadImage(sceneUrl), aspect);
  const k = Math.min((sh * size) / cut.height, (sw * 0.62) / cut.width);
  const w = cut.width * k;
  const h = cut.height * k;
  const x = (sw - w) / 2;
  const y = sh * 0.88 - h;
  ctx.save();
  ctx.filter = `blur(${Math.round(sw * 0.012)}px)`;
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.beginPath();
  ctx.ellipse(sw / 2, y + h - h * 0.01, w * 0.5, Math.max(6, h * 0.035), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cut, x, y, w, h);
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
