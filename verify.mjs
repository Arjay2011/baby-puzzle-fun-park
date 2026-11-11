/**
 * 独立复检：直接对 preview-art.png 做像素级取证，并用同一份 characters.js
 * 渲染出角色遮罩，把两者对齐后逐条验证 8 个问题。
 */
import { chromium } from '/Users/zenghuanjia/.workbuddy/binaries/node/workspace/node_modules/playwright/index.mjs';
import { readFileSync, writeFileSync } from 'fs';
import { decodePNG, px, hex, lum, cr } from './png.mjs';

const chars = readFileSync(new URL('./characters.js', import.meta.url), 'utf8').replace(/export /g, '');
const img = decodePNG(new URL('./preview-art.png', import.meta.url).pathname);

const KINDS = ['dog', 'cat', 'rabbit', 'penguin', 'panda', 'chick'];
// render-preview.mjs 用的调色板名（注意 blossom/dawn 在 PALETTES 里不存在 → 回落 meadow）
const PREVIEW_PALS = ['meadow', 'sunny', 'blossom', 'polar', 'bamboo', 'dawn'];
// puzzle-parts.js 里实际游戏用的调色板
const GAME_PALS = ['meadow', 'sunny', 'lilac', 'polar', 'bamboo', 'aqua'];

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.setContent(`<!doctype html><html><body style="margin:0"><script>${chars}</script></body></html>`);

// 角色遮罩（与 drawScene 完全相同的放置方式）
const masks = await page.evaluate(([KINDS, PREVIEW_PALS, W, H]) => {
  const out = {};
  KINDS.forEach((kind, i) => {
    const { unit, ground, x } = characterLayout(W, H);
    const imgC = withOutline(renderCharacterCanvas(kind), OUTLINE[kind] || '#5A4034');
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.drawImage(imgC, x, ground - DESIGN.base * unit, DESIGN.w * unit, (DESIGN.bottom - DESIGN.top) * unit);
    const d = ctx.getImageData(0, 0, W, H).data;
    const mask = new Uint8Array(W * H);
    for (let k = 0; k < W * H; k++) mask[k] = d[k * 4 + 3] > 40 ? 1 : 0;
    out[kind] = { mask: Array.from(mask), unit, ground, x, top: DESIGN.top, base: DESIGN.base };
  });
  return out;
}, [KINDS, PREVIEW_PALS, 400, 360]);

// 整幅预览重渲染（用于和 PNG 逐像素比对，确认图=当前代码）
const rerender = await page.evaluate(([KINDS, PREVIEW_PALS, W, H]) => {
  const cv = document.createElement('canvas'); cv.width = W * 3; cv.height = H * 2;
  const ctx = cv.getContext('2d');
  KINDS.forEach((k, i) => {
    const col = i % 3, row = (i / 3) | 0;
    ctx.save(); ctx.translate(col * 400, row * 360);
    drawScene(ctx, 400, 360, k, PREVIEW_PALS[i]);
    ctx.restore();
  });
  return Array.from(ctx.getImageData(0, 0, W * 3, H * 2).data);
}, [KINDS, PREVIEW_PALS, 400, 360]);

// ---- PNG 与重渲染比对 ----
let diff = 0, maxd = 0;
for (let i = 0; i < 1200 * 720 * 3; i++) {
  const d = Math.abs(img.data[i] - rerender[i]);
  if (d > 8) diff++;
  if (d > maxd) maxd = d;
}
console.log(`[比对] preview-art.png vs 当前代码重渲染：不一致像素 ${diff}/${1200*720*3} (${(diff/(1200*720*3)*100).toFixed(2)}%)，最大通道差 ${maxd}`);

// ---- 每个格子的背景色（判断预览实际用了哪个 palette）----
console.log('\n[调色板核对] 各格天空/草地取色');
KINDS.forEach((k, i) => {
  const col = i % 3, row = (i / 3) | 0;
  const gx = col * 400, gy = row * 360;
  console.log(`  ${k}: 天空 ${hex(px(img, gx + 20, gy + 20))} 草地 ${hex(px(img, gx + 200, gy + 345))} (预览用 ${PREVIEW_PALS[i]} / 游戏用 ${GAME_PALS[i]})`);
});

const CELL = { w: 400, h: 360 };
const at = (kind, dx, dy) => {
  const m = masks[kind];
  const x = Math.round(m.x + dx * m.unit);
  const y = Math.round(m.ground - (m.base - dy) * m.unit);
  return { x, y };
};

const results = {};
for (const kind of KINDS) {
  const m = masks[kind];
  const mask = m.mask;
  const W = 400, H = 360;
  let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, topRun = 0, topInk = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!mask[y * W + x]) continue;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (y === 0) topInk++;
  }
  // 顶边最大连续水平长度（平切=长，圆头=短）
  let best = 0, cur = 0;
  for (let x = 0; x < W; x++) { if (mask[x]) { cur++; best = Math.max(best, cur); } else cur = 0; }
  topRun = best;
  results[kind] = { minX, minY, maxX, maxY, topInk, topRun, unit: m.unit, ground: m.ground, x: m.x };
}
console.log('\n[几何] 各角色在 400×360 格内的像素包围盒');
for (const k of KINDS) {
  const r = results[k];
  console.log(`  ${k}: bbox=[${r.minX},${r.minY},${r.maxX},${r.maxY}] 宽${r.maxX-r.minX} 高${r.maxY-r.minY} 顶行像素${r.topInk} 顶边最大水平连续${r.topRun}px 底部y=${r.maxY} unit=${r.unit.toFixed(3)}`);
}

// ---- 逐条问题检查 ----
const probe = (kind, dx, dy) => {
  const { x, y } = at(kind, dx, dy);
  if (x < 0 || y < 0 || x >= 400 || y >= 360) return null;
  const gx = (KINDS.indexOf(kind) % 3) * 400 + x, gy = ((KINDS.indexOf(kind) / 3) | 0) * 360 + y;
  return px(img, gx, gy);
};

console.log('\n[问题1] 兔子长耳是否仍被切 / 耳形是否完整');
{
  const r = results.rabbit;
  console.log(`  顶行像素=${r.topInk}（0=无裁切）  上沿 y=${r.minY}（耳顶与格顶距离 ${r.minY}px）  顶边最大水平连续=${r.topRun}px（平切会 ≫40）`);
  for (const d of [[79, 6], [79, 14], [79, 26], [121, 6], [121, 14], [121, 26], [79, 40], [121, 40]])
    console.log(`    设计点(${d[0]},${d[1]}) → ${hex(probe('rabbit', d[0], d[1]))}`);
  // 耳朵高度：头顶(椭圆上沿 y=44)之上连续的兔色像素列高度
  const col = 79;
  let run = 0, top = -1;
  for (let dy = 0; dy < 100; dy++) { const p = probe('rabbit', col, dy); if (p && lum(p) > 120) { if (top < 0) top = dy; run++; } else if (top >= 0) break; }
  console.log(`  左耳(x=79)从设计 y=${top} 起连续 ${run}px（耳朵长度）；被切则该值≈0`);
}

console.log('\n[问题2] 小鸡呆毛是否可见');
{
  for (const d of [[104, 26], [100, 30], [96, 38], [106, 34], [100, 44], [100, 52], [100, 58], [100, 66]])
    console.log(`    设计点(${d[0]},${d[1]}) → ${hex(probe('chick', d[0], d[1]))}`);
  // 呆毛露出面积：统计头部轮廓之上 #F7C23F 附近像素
  const W = 400, H = 360; const gx0 = 2 * 400, gy0 = 360;
  let crest = 0, aboveHead = 0;
  const headTop = 47; // 头部椭圆上沿
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = px(img, gx0 + x, gy0 + y);
    if (p[0] > 235 && p[1] > 175 && p[1] < 215 && p[2] < 80) { crest++; }
  }
  console.log(`  小鸡格内橙黄(呆毛/翅)像素 ${crest}`);
}

console.log('\n[问题3] 小鸡/兔子与背景的真实边缘对比度（直接取 PNG 边缘像素 vs 相邻背景像素）');
for (const kind of KINDS) {
  const W = 400, H = 360; const m = masks[kind]; const mask = m.mask;
  const col = KINDS.indexOf(kind) % 3, row = (KINDS.indexOf(kind) / 3) | 0;
  const gx0 = col * 400, gy0 = row * 360;
  const ratios = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (!mask[y * W + x]) continue;
    let edge = false, bg = null;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      if (mask[(y+dy)*W+(x+dx)]) continue;
      edge = true;
      const bgp = px(img, gx0 + x + dx, gy0 + y + dy);
      if (!bg || cr(px(img, gx0+x, gy0+y), bgp) < cr(px(img, gx0+x, gy0+y), bg)) bg = bgp;
    }
    if (edge && bg) ratios.push(cr(px(img, gx0+x, gy0+y), bg));
  }
  ratios.sort((a,b)=>a-b);
  const q = f => ratios[Math.min(ratios.length-1, Math.floor(ratios.length*f))];
  const low = ratios.filter(r => r < 1.4).length / ratios.length * 100;
  console.log(`  ${kind}: 边缘像素 ${ratios.length}  最低 ${q(0).toFixed(2)} 中位 ${q(0.5).toFixed(2)} p95 ${q(0.95).toFixed(2)}  <1.4 占比 ${low.toFixed(1)}%`);
}

console.log('\n[问题4] 狗/猫/熊猫后腿可见量（真实 PNG 里腿色像素数 / 腿椭圆理论面积）');
for (const [kind, leg] of [['dog',[201,138,75]],['cat',[229,138,60]],['panda',[58,58,58]],['rabbit',[233,222,210]]]) {
  const W=400,H=360; const col=KINDS.indexOf(kind)%3, row=(KINDS.indexOf(kind)/3)|0;
  const gx0=col*400, gy0=row*360; const m=masks[kind];
  // 腿区：设计 y 170..190，x 50..150
  let cnt=0, tot=0;
  for (let dy=168; dy<=191; dy++) for (let dx=48; dx<=152; dx++) {
    const { x, y } = at(kind, dx, dy);
    if (x<0||y<0||x>=W||y>=H) continue;
    if (!m.mask[y*W+x]) continue;
    tot++;
    const p = px(img, gx0+x, gy0+y);
    if (Math.abs(p[0]-leg[0])<18 && Math.abs(p[1]-leg[1])<18 && Math.abs(p[2]-leg[2])<18) cnt++;
  }
  console.log(`  ${kind}: 腿区角色像素 ${tot}，其中腿色 ${cnt}（${(cnt/Math.max(1,tot)*100).toFixed(0)}% 可见为腿）`);
}

console.log('\n[问题5] 兔子门牙');
for (const d of [[96,118],[96,122],[96,126],[104,118],[104,122],[104,126],[96,114],[100,112],[90,122],[110,122]])
  console.log(`    设计点(${d[0]},${d[1]}) → ${hex(probe('rabbit', d[0], d[1]))}`);

console.log('\n[问题6] 猫耳 vs 头部');
for (const d of [[68,30],[75,25],[60,50],[100,60],[130,25],[140,50],[100,95]])
  console.log(`    设计点(${d[0]},${d[1]}) → ${hex(probe('cat', d[0], d[1]))}`);

console.log('\n[问题8] 各角色眼睛中心 / 眼白与虹膜占比');
for (const [kind, dx, dy] of [['dog',82,74],['cat',81,80],['rabbit',82,86],['penguin',83,68],['panda',79,80],['chick',84,86]]) {
  console.log(`  ${kind} 眼中心(${dx},${dy}) → ${hex(probe(kind, dx, dy))}`);
}

// 眼白占比：统计眼睛小邻域内极亮像素比例
console.log('\n[问题8b] 眼睛区域「白心空心圈」量化：眼睛半径内白色像素占比');
for (const [kind, dx, dy, r] of [['dog',82,74,10],['cat',81,80,10],['rabbit',82,86,9.5],['penguin',83,68,8.5],['chick',84,86,9],['panda',79,80,9.5]]) {
  let white=0, dark=0, tot=0;
  for (let a=-r; a<=r; a+=0.5) for (let b=-r; b<=r; b+=0.5) {
    if (a*a+b*b > r*r) continue;
    const p = probe(kind, dx+a, dy+b); if (!p) continue;
    tot++;
    if (p[0]>225&&p[1]>225&&p[2]>225) white++;
    if (lum(p) < 90) dark++;
  }
  console.log(`  ${kind}: 眼区亮白 ${(white/tot*100).toFixed(1)}%，深色 ${(dark/tot*100).toFixed(1)}%（深色>35% 视为正常黑眼珠）`);
}

writeFileSync('/tmp/masks.json', JSON.stringify({ results, masks }));
await browser.close();
