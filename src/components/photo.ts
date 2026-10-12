import { isValidPhoto } from '../lib/profiles';

export const PHOTO_SIZE = 256;
const MAX_INPUT_BYTES = 20 * 1024 * 1024;

/**
 * Turn a picked/pasted/dropped image into a square 256 px JPEG data URL.
 * Re-encoding through a canvas keeps only pixels: EXIF data such as the GPS
 * position or the camera serial never reaches the profile file.
 */
export async function photoToDataUrl(blob: Blob): Promise<string> {
  if (!blob.type.startsWith('image/')) throw new Error('ไฟล์นี้ไม่ใช่รูปภาพ');
  if (blob.size > MAX_INPUT_BYTES) throw new Error('รูปมีขนาดใหญ่เกิน 20 MB');
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob);
  } catch {
    throw new Error('อ่านรูปนี้ไม่ได้ (รองรับ JPG, PNG, WebP, GIF)');
  }
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = PHOTO_SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  // Transparent images get a white background (JPEG has no alpha).
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PHOTO_SIZE, PHOTO_SIZE);
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
  bmp.close();
  return canvas.toDataURL('image/jpeg', 0.85);
}

function dataUrlToBlob(url: string): Blob {
  const comma = url.indexOf(',');
  const mime = url.slice(5, url.indexOf(';'));
  const bin = atob(url.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Re-encode a photo read from a profile file; undefined if it is not a real image. */
export async function reencodePhoto(url: string | undefined): Promise<string | undefined> {
  if (!isValidPhoto(url)) return undefined;
  try {
    return await photoToDataUrl(dataUrlToBlob(url));
  } catch {
    return undefined;
  }
}

// Decoded photos for drawing node icons. Decoding is asynchronous, so charts
// draw a placeholder first and redraw when a photo becomes ready.
const images = new Map<string, HTMLImageElement>();
const listeners = new Set<() => void>();

export function photoImage(url: string): HTMLImageElement | undefined {
  let img = images.get(url);
  if (!img) {
    img = new Image();
    img.onload = () => listeners.forEach((l) => l());
    img.src = url;
    images.set(url, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : undefined;
}

export function onPhotoLoad(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
