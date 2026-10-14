// Resident photo processing: downscale on a canvas and re-encode as JPEG so a
// report stays small enough for slow phone connections and the realtime
// database. Resolves { dataUrl, bytes } or rejects with an Error whose message
// is safe to show to a resident.

export const MAX_EDGE = 960;
export const TARGET_BYTES = 150 * 1024;
const START_QUALITY = 0.8;
const MIN_QUALITY = 0.3;
const QUALITY_STEP = 0.1;
const SHRINK = 0.8;
const MAX_SHRINKS = 4;

const FRIENDLY = 'We could not use that photo. Try another one, or send your report without a photo.';

function fail(message = FRIENDLY) {
  return new Error(message);
}

/** Bytes of the binary behind a base64 data URL. */
export function dataUrlBytes(dataUrl) {
  const i = dataUrl.indexOf(',');
  const b64 = i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close?.() };
    } catch {
      /* fall through to <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(fail());
      el.src = url;
    });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function render(decoded, scale) {
  const w = Math.max(1, Math.round(decoded.width * scale));
  const h = Math.max(1, Math.round(decoded.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw fail();
  // JPEG has no alpha: paint white first so transparent PNGs do not turn black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(decoded.source, 0, 0, w, h);
  return canvas;
}

export async function processPhoto(file) {
  if (!file || !/^image\//.test(file.type || '')) throw fail('That file is not a picture. Please choose a photo.');
  let decoded;
  try {
    decoded = await decode(file);
  } catch {
    throw fail();
  }
  try {
    if (!decoded.width || !decoded.height) throw fail();
    let scale = Math.min(1, MAX_EDGE / Math.max(decoded.width, decoded.height));
    let last = null;
    for (let shrink = 0; shrink <= MAX_SHRINKS; shrink += 1) {
      const canvas = render(decoded, scale);
      for (let q = START_QUALITY; q >= MIN_QUALITY - 1e-9; q -= QUALITY_STEP) {
        const dataUrl = canvas.toDataURL('image/jpeg', Math.round(q * 100) / 100);
        if (!dataUrl.startsWith('data:image/jpeg')) throw fail();
        const bytes = dataUrlBytes(dataUrl);
        last = { dataUrl, bytes };
        if (bytes <= TARGET_BYTES) return last;
      }
      scale *= SHRINK;
    }
    if (last && last.bytes <= TARGET_BYTES * 1.5) return last;
    throw fail('That photo is too detailed to send on this connection. Try another one.');
  } catch (err) {
    throw err instanceof Error && err.message ? err : fail();
  } finally {
    decoded.release();
  }
}
