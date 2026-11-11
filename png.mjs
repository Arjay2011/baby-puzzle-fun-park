/** 极简 PNG 解码（8bit RGB / 非隔行），供像素级取证 */
import { readFileSync } from 'fs';
import { inflateSync } from 'zlib';

export function decodePNG(path) {
  const b = readFileSync(path);
  let o = 8, w = 0, h = 0, ct = 0, bd = 0;
  const idat = [];
  while (o < b.length) {
    const len = b.readUInt32BE(o);
    const type = b.slice(o + 4, o + 8).toString();
    if (type === 'IHDR') {
      w = b.readUInt32BE(o + 8); h = b.readUInt32BE(o + 12);
      bd = b[o + 16]; ct = b[o + 17];
      if (b[o + 20] !== 0) throw new Error('interlaced not supported');
    } else if (type === 'IDAT') idat.push(b.slice(o + 8, o + 8 + len));
    o += 12 + len;
    if (type === 'IEND') break;
  }
  if (bd !== 8) throw new Error('bitdepth ' + bd);
  const ch = ct === 2 ? 3 : ct === 6 ? 4 : ct === 0 ? 1 : -1;
  if (ch < 0) throw new Error('colortype ' + ct);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(w * h * ch);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[pos++];
    const row = raw.subarray(pos, pos + stride); pos += stride;
    const cur = out.subarray(y * stride, y * stride + stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0;
      const bb = prev ? prev[i] : 0;
      const c = (prev && i >= ch) ? prev[i - ch] : 0;
      let v = row[i];
      if (f === 1) v += a;
      else if (f === 2) v += bb;
      else if (f === 3) v += (a + bb) >> 1;
      else if (f === 4) {
        const p = a + bb - c, pa = Math.abs(p - a), pb = Math.abs(p - bb), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? bb : c);
      }
      cur[i] = v & 255;
    }
  }
  return { w, h, ch, data: out };
}

export const px = (img, x, y) => {
  const i = (y * img.w + x) * img.ch;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};
export const hex = (c) => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
export const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
export const cr = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
