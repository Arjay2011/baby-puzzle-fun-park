/**
 * 第二轮复检：
 *  1) 逐格比对 PNG 与当前代码渲染结果，定位 preview-art.png 是否同步
 *  2) 用修正后的设计坐标→屏幕坐标映射重新取证
 */
import { chromium } from '/Users/zenghuanjia/.workbuddy/binaries/node/workspace/node_modules/playwright/index.mjs';
import { readFileSync } from 'fs';
import { decodePNG, px, hex, lum, cr } from './png.mjs';

const chars = readFileSync(new URL('./characters.js', import.meta.url), 'utf8').replace(/export /g, '');
const img = decodePNG(new URL('./preview-art.png', import.meta.url).pathname);
const KINDS = ['dog', 'cat', 'rabbit', 'penguin', 'panda', 'chick'];
const PREVIEW_PALS = ['meadow', 'sunny', 'blossom', 'polar', 'bamboo', 'dawn'];
const GAME_PALS = ['meadow', 'sunny', 'lilac', 'polar', 'bamboo', 'aqua'];

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.setContent(`<!doctype html><html><body style="margin:0"><script>${chars}</script></body></html>`);

const render = async (pals) => await page.evaluate(([KINDS, pals, W, H]) => {
  const cv = document.createElement('canvas'); cv.width = W * 3; cv.height = H * 2;
  const ctx = cv.getContext('2d');
  KINDS.forEach((k, i) => {
    const col = i % 3, row = (i / 3) | 0;
    ctx.save(); ctx.translate(col * 400, row * 360);
    drawScene(ctx, 400, 360, k, pals[i]);
    ctx.restore();
  });
  return Array.from(ctx.getImageData(0, 0, W * 3, H * 2).data);
}, [KINDS, pals, 400, 360]);

const A = await render(PREVIEW_PALS);
const B = await render(GAME_PALS);

const cellDiff = (buf) => {
  const out = [];
  for (let i = 0; i < 6; i++) {
    const col = i % 3, row = (i / 3) | 0;
    let d = 0, n = 0, max = 0;
    for (let y = 0; y < 360; y++) for (let x = 0; x < 400; x++) {
      const s = ((row * 360 + y) * 1200 + col * 400 + x) * 3;
      const p = ((y * 400 + x) * 3);
      const dd = Math.max(Math.abs(img.data[s] - buf[p]), Math.abs(img.data[s+1] - buf[p+1]), Math.abs(img.data[s+2] - buf[p+2]));
      if (dd > 12) d++;
      if (dd > max) max = dd;
      n++;
    }
    out.push({ pct: +(d / n * 100).toFixed(2), max });
  }
  return out;
};
const dA = cellDiff(A), dB = cellDiff(B);
console.log('[逐格比对] preview-art.png vs 重渲染（阈值12）');
KINDS.forEach((k, i) => {
  console.log(`  ${k}: 用预览pal(${PREVIEW_PALS[i]}) 差异 ${dA[i].pct}% (max ${dA[i].max})   用游戏pal(${GAME_PALS[i]}) 差异 ${dB[i].pct}% (max ${dB[i].max})`);
});

// 用最接近的那套 palette 作为「PNG 对应版本」，并计算角色遮罩
const best = dA.map((d, i) => ({ d: Math.min(d.pct, dB[i].pct), useA: d.pct <= dB[i].pct }));
console.log('\n[结论] 每格 PNG 最匹配的 palette 组合：', best.map((b, i) => `${KINDS[i]}=${b.useA ? PREVIEW_PALS[i] : GAME_PALS[i]}(${b.d}%)`).join(' '));

// ---- 修正后的坐标映射 ----
// 设计 dy → 屏幕 y = ground + (dy - 180)*unit   （离屏画布自 top=-10 起算）
// 设计 dx → 屏幕 x = x + dx*unit
const geo = await page.evaluate(([KINDS, W, H]) => {
  const o = {};
  for (const kind of KINDS) {
    const { unit, ground, x } = characterLayout(W, H);
    const imgC = withOutline(renderCharacterCanvas(kind), OUTLINE[kind] || '#5A4034');
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.drawImage(imgC, x, ground - DESIGN.base * unit, DESIGN.w * unit, (DESIGN.bottom - DESIGN.top) * unit);
    const d = ctx.getImageData(0, 0, W, H).data;
    const mask = new Uint8Array(W * H);
    for (let k = 0; k < W * H; k++) mask[k] = d[k * 4 + 3] > 40 ? 1 : 0;
    o[kind] = { mask: Array.from(mask), unit, ground, x };
  }
  return o;
}, [KINDS, 400, 360]);

const s2p = (kind, dx, dy) => {
  const m = geo[kind];
  return { x: Math.round(m.x + dx * m.unit), y: Math.round(m.ground + (dy - 180) * m.unit) };
};
const probe = (kind, dx, dy) => {
  const { x, y } = s2p(kind, dx, dy);
  if (x < 0 || y < 0 || x >= 400 || y >= 360) return null;
  const i = KINDS.indexOf(kind), gx = (i % 3) * 400 + x, gy = ((i / 3) | 0) * 360 + y;
  return px(img, gx, gy);
};

console.log('\n[问题1] 兔子长耳（设计坐标 → 真实 PNG 采样）');
for (const d of [[79,4],[79,10],[79,16],[79,26],[79,40],[79,52],[121,4],[121,16],[121,26],[121,40],[79,60]])
  console.log(`   (${d[0]},${d[1]}) → ${hex(probe('rabbit', d[0], d[1]))}`);

console.log('\n[问题2] 小鸡呆毛');
for (const d of [[104,16],[104,22],[104,28],[100,34],[96,40],[106,40],[100,46],[100,52],[100,58],[100,64],[84,86],[100,90]])
  console.log(`   (${d[0]},${d[1]}) → ${hex(probe('chick', d[0], d[1]))}`);

console.log('\n[问题5] 兔子门牙 vs 口鼻');
for (const d of [[96,118],[96,124],[96,128],[104,118],[104,124],[104,128],[100,112],[100,116],[88,124],[112,124]])
  console.log(`   (${d[0]},${d[1]}) → ${hex(probe('rabbit', d[0], d[1]))}`);

console.log('\n[问题6] 猫耳 / 猫脸');
for (const d of [[68,30],[80,22],[60,52],[100,60],[130,22],[140,52],[100,95],[85,80],[100,100]])
  console.log(`   (${d[0]},${d[1]}) → ${hex(probe('cat', d[0], d[1]))}`);

console.log('\n[问题8] 眼睛中心（修正坐标）');
for (const [kind, dx, dy] of [['dog',82,74],['cat',81,80],['rabbit',82,86],['penguin',83,68],['panda',79,80],['chick',84,86]])
  console.log(`   ${kind} (${dx},${dy}) → ${hex(probe(kind, dx, dy))}`);

console.log('\n[问题8b] 眼区白/暗占比');
for (const [kind, dx, dy, r] of [['dog',82,74,10],['cat',81,80,10],['rabbit',82,86,9.5],['penguin',83,68,8.5],['chick',84,86,9],['panda',79,80,9.5]]) {
  let white=0, dark=0, tot=0;
  for (let a=-r; a<=r; a+=0.4) for (let b=-r; b<=r; b+=0.4) {
    if (a*a+b*b > r*r) continue;
    const p = probe(kind, dx+a, dy+b); if (!p) continue;
    tot++;
    if (p[0]>225&&p[1]>225&&p[2]>225) white++;
    if (lum(p) < 95) dark++;
  }
  console.log(`   ${kind}: 亮白 ${(white/tot*100).toFixed(1)}%  深色 ${(dark/tot*100).toFixed(1)}%  (tot ${tot})`);
}

console.log('\n[问题4] 后腿可见性（设计 y=178..190 区域腿色占比）');
for (const [kind, leg] of [['dog',[201,138,75]],['cat',[229,138,60]],['panda',[58,58,58]],['rabbit',[233,222,210]]]) {
  let cnt=0, tot=0, area=0;
  for (let dy=170; dy<=191; dy++) for (let dx=46; dx<=154; dx++) {
    const { x, y } = s2p(kind, dx, dy);
    if (x<0||y<0||x>=400||y>=360) continue;
    const m = geo[kind];
    if (!m.mask[y*400+x]) continue;
    tot++;
    const i = KINDS.indexOf(kind), p = px(img, (i%3)*400+x, ((i/3)|0)*360+y);
    if (Math.abs(p[0]-leg[0])<20 && Math.abs(p[1]-leg[1])<20 && Math.abs(p[2]-leg[2])<20) cnt++;
  }
  console.log(`   ${kind}: 区域像素 ${tot}，腿色 ${cnt} (${(cnt/Math.max(1,tot)*100).toFixed(0)}%)`);
}

// 脚底/基线：各角色最低像素 & 阴影位置
console.log('\n[问题7] 基线与阴影');
for (const kind of KINDS) {
  const m = geo[kind]; let maxY=-1;
  for (let y=0;y<360;y++) for (let x=0;x<400;x++) if (m.mask[y*400+x] && y>maxY) maxY=y;
  const i = KINDS.indexOf(kind);
  console.log(`   ${kind}: 最低像素 y=${maxY}  ground=${m.ground.toFixed(1)}  超出地平线 ${(maxY-m.ground).toFixed(1)}px`);
}

await browser.close();
