/**
 * 阶段 I（定点验证）：L1 两块拼块实际显示的是场景图的哪个区域？
 */
import { chromium } from '/Users/zenghuanjia/.workbuddy/binaries/node/workspace/node_modules/playwright/index.mjs';
import { readFileSync, writeFileSync } from 'fs';

const ROOT = '/Users/zenghuanjia/WorkBuddy/2026-11-11-10-31-19/';
const FILE = 'file://' + ROOT + '拼图乐园.html';
const partsSrc = readFileSync(ROOT + 'puzzle-parts.js', 'utf8').replace(/^\s*import\s+[^;]+;\s*$/gm, '').replace(/^\s*export\s+(const|function|let|var|class)\s/gm, '$1 ').replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, '');
const charsSrc = readFileSync(ROOT + 'characters.js', 'utf8').replace(/^\s*import\s+[^;]+;\s*$/gm, '').replace(/^\s*export\s+(const|function|let|var|class)\s/gm, '$1 ').replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, '');
const inject = `${partsSrc}\n${charsSrc}\nwindow.__P={LEVELS,buildLevel,computeLayout,drawScene};`;
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 900, height: 780 } });
await page.addInitScript(inject);
await page.goto(FILE); await page.waitForTimeout(700);

const r = await page.evaluate(() => {
  const mod = window.__P;
  const lv = mod.LEVELS[0];                       // L1 小狗豆豆 2x1
  const built = mod.buildLevel(lv, lv.id);
  const layout = mod.computeLayout(built.pieces, lv.cols, lv.rows, 900, 780, { margin: 14, trayGap: 18, maxCell: 168, minCell: 48 });
  const pw = 512, ph = 256;
  const scene = document.createElement('canvas'); scene.width = pw; scene.height = ph;
  mod.drawScene(scene.getContext('2d'), pw, ph, lv.kind, lv.pal);
  const sd = scene.getContext('2d').getImageData(0, 0, pw, ph).data;

  const cell = layout.cell, cellInScene = pw / lv.cols, k = cell / cellInScene;
  const out = [];
  built.pieces.forEach((p, idx) => {
    const bmpW = Math.ceil(cell * 2.4), bmpH = bmpW;
    const srcX = (p.anchor[0] / lv.cols) * pw, srcY = (p.anchor[1] / lv.rows) * ph;
    const c = document.createElement('canvas'); c.width = bmpW; c.height = bmpH;
    const cc = c.getContext('2d');
    const cx = bmpW / 2, cy = bmpH / 2;
    const poly = p.poly.map((pt) => [cx + pt[0] * cell, cy + pt[1] * cell]);
    cc.save(); cc.beginPath();
    poly.forEach((pt, i) => (i === 0 ? cc.moveTo(pt[0], pt[1]) : cc.lineTo(pt[0], pt[1])));
    cc.closePath(); cc.clip();
    cc.drawImage(scene, srcX - (bmpW / 2) / k, srcY - (bmpH / 2) / k, bmpW / k, bmpH / k);
    cc.restore();
    const d = cc.getImageData(0, 0, bmpW, bmpH).data;

    // 该块在场景中的正确区域
    const wantX0 = p.minCol * cellInScene, wantX1 = (p.maxCol + 1) * cellInScene;
    const wantY0 = p.minRow * (ph / lv.rows), wantY1 = (p.maxRow + 1) * (ph / lv.rows);

    // 在「现状」贴图中心附近取样，求其对应的场景坐标
    const sample = (bx, by) => {
      const scale = (bmpW / k) / pw;
      const dx0 = srcX - (bmpW / 2) / k, dy0 = srcY - (bmpH / 2) / k;
      return { sx: (bx - dx0) / scale, sy: (by - dy0) / scale };
    };
    const inPoly = (x, y, pts) => { let ins = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins; } return ins; };

    // 统计「现状贴图」在多边形内的像素分别落在场景图的哪些区域
    const zone = { 正确区: 0, 左半场景: 0, 右半场景: 0, 上半场景: 0, 下半场景: 0, 场景外: 0 };
    let n = 0, dogPixels = 0;
    const inPolyPts = [];
    for (let y = 0; y < bmpH; y++) for (let x = 0; x < bmpW; x++) {
      if (!inPoly(x, y, poly)) continue;
      n++;
      const s = sample(x, y);
      if (s.sx < 0 || s.sx >= pw || s.sy < 0 || s.sy >= ph) { zone['场景外']++; continue; }
      const si = (Math.round(s.sy) * pw + Math.round(s.sx)) * 4;
      const [r, g, b] = [sd[si], sd[si + 1], sd[si + 2]];
      // 狗毛色 #F5DCB0 / #C98A4B / 鼻 #4A3B35 / 眼 #2B2320
      const isDog = (Math.abs(r - 245) < 26 && Math.abs(g - 220) < 30 && Math.abs(b - 176) < 40)
        || (Math.abs(r - 201) < 26 && Math.abs(g - 138) < 30 && Math.abs(b - 75) < 40)
        || (r < 90 && g < 80 && b < 80);
      if (isDog) dogPixels++;
      if (s.sx >= wantX0 && s.sx < wantX1 && s.sy >= wantY0 && s.sy < wantY1) zone['正确区']++;
      else { if (s.sx < pw / 2) zone['左半场景']++; else zone['右半场景']++;
             if (s.sy < ph / 2) zone['上半场景']++; else zone['下半场景']++; }
    }
    // 正确块内应有多少狗像素（从场景直接算）
    let dogWant = 0, wantN = 0;
    for (let y = Math.round(wantY0); y < Math.round(wantY1); y++) for (let x = Math.round(wantX0); x < Math.round(wantX1); x++) {
      const si = (y * pw + x) * 4; const [r, g, b] = [sd[si], sd[si + 1], sd[si + 2]];
      wantN++;
      const isDog = (Math.abs(r - 245) < 26 && Math.abs(g - 220) < 30 && Math.abs(b - 176) < 40)
        || (Math.abs(r - 201) < 26 && Math.abs(g - 138) < 30 && Math.abs(b - 75) < 40)
        || (r < 90 && g < 80 && b < 80);
      if (isDog) dogWant++;
    }
    out.push({
      id: p.id, 格子: p.cells.map((c) => c.join('')).join('/'),
      正确区域_场景x: [wantX0, wantX1], 正确区域_场景y: [wantY0, wantY1],
      贴图内像素: n,
      落在正确区域的比例: +(zone['正确区'] / (n || 1) * 100).toFixed(1),
      分布: zone,
      贴图内狗像素占比: +(dogPixels / (n || 1) * 100).toFixed(1),
      正确块内狗像素占比: +(dogWant / (wantN || 1) * 100).toFixed(1),
    });
  });
  return out;
});
console.log('=== L1（小狗，2 片）拼块实际显示区域 vs 正确区域 ===');
for (const x of r) {
  console.log(`\n拼块 id${x.id} 格子=${x.格子}`);
  console.log(`  正确区域: 场景 x[${x.正确区域_场景x}] y[${x.正确区域_场景y}]`);
  console.log(`  贴图内像素落点分布: ${JSON.stringify(x.分布)}`);
  console.log(`  ⇒ 落在正确区域: ${x.落在正确区域的比例}%   实际狗像素占比 ${x.贴图内狗像素占比}% vs 正确块应为 ${x.正确块内狗像素占比}%`);
}
await browser.close();
