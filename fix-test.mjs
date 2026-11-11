/**
 * 阶段 G（根因确认）：对比「现状取样」与「正确取样」在归位后与参考图的相关性
 * 同时输出 6 角色完整头部图
 */
import { chromium } from '/Users/zenghuanjia/.workbuddy/binaries/node/workspace/node_modules/playwright/index.mjs';
import { readFileSync } from 'fs';

const ROOT = '/Users/zenghuanjia/WorkBuddy/2026-11-11-10-31-19/';
const FILE = 'file://' + ROOT + '拼图乐园.html';
const partsSrc = readFileSync(ROOT + 'puzzle-parts.js', 'utf8').replace(/^\s*import\s+[^;]+;\s*$/gm, '').replace(/^\s*export\s+(const|function|let|var|class)\s/gm, '$1 ').replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, '');
const charsSrc = readFileSync(ROOT + 'characters.js', 'utf8').replace(/^\s*import\s+[^;]+;\s*$/gm, '').replace(/^\s*export\s+(const|function|let|var|class)\s/gm, '$1 ').replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, '');
const inject = `${partsSrc}\n${charsSrc}\nwindow.__P={LEVELS,buildLevel,computeLayout,drawScene,drawThumb};`;
const browser = await chromium.launch({ channel: 'chrome' });

const page = await browser.newPage({ viewport: { width: 900, height: 780 } });
await page.addInitScript(inject);
await page.goto(FILE); await page.waitForTimeout(700);

const out = await page.evaluate(() => {
  const mod = window.__P, res = [];
  for (const lv of mod.LEVELS) {
    const built = mod.buildLevel(lv, lv.id);
    const layout = mod.computeLayout(built.pieces, lv.cols, lv.rows, 900, 780, { margin: 14, trayGap: 18, maxCell: 168, minCell: 48 });
    const pw = 512, ph = Math.round(pw * (lv.rows / lv.cols));
    const scene = document.createElement('canvas'); scene.width = pw; scene.height = ph;
    mod.drawScene(scene.getContext('2d'), pw, ph, lv.kind, lv.pal);
    const sd = scene.getContext('2d').getImageData(0, 0, pw, ph).data;
    const cell = layout.cell, cellInScene = pw / lv.cols, k = cell / cellInScene;

    // 画一张「现状」板（现状取样）与「修正」板（正确裁剪取样），按凹槽位置摆放
    const N = 48;
    const boardW = layout.boardW, boardH = layout.boardH;
    const bufNow = new Float32Array(N * N), bufFix = new Float32Array(N * N);
    for (const p of built.pieces) {
      const bmpW = Math.ceil(cell * 2.4), bmpH = bmpW;
      const srcX = (p.anchor[0] / lv.cols) * pw, srcY = (p.anchor[1] / lv.rows) * ph;
      const cx = bmpW / 2, cy = bmpH / 2;
      const poly = p.poly.map((pt) => [cx + pt[0] * cell, cy + pt[1] * cell]);
      const inPoly = (x, y, pts) => { let ins = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins; } return ins; };

      const mk = (drawFn) => { const c = document.createElement('canvas'); c.width = bmpW; c.height = bmpH;
        const cc = c.getContext('2d'); cc.save(); cc.beginPath();
        poly.forEach((pt, i) => (i === 0 ? cc.moveTo(pt[0], pt[1]) : cc.lineTo(pt[0], pt[1])));
        cc.closePath(); cc.clip(); drawFn(cc); cc.restore();
        return cc.getImageData(0, 0, bmpW, bmpH).data; };

      // 现状：5 参 drawImage（整图缩放）
      const dNow = mk((cc) => cc.drawImage(scene, srcX - (bmpW / 2) / k, srcY - (bmpH / 2) / k, bmpW / k, bmpH / k));
      // 修正：9 参 drawImage（真实裁剪本块区域）
      const wantX = p.minCol * cellInScene, wantY = p.minRow * (ph / lv.rows);
      const wantW = p.wCells * cellInScene, wantH = p.hCells * (ph / lv.rows);
      const dFix = mk((cc) => {
        // 把本块在场景中的矩形映射到位图
        const bx = cx + (p.minCol + p.wCells / 2 - p.anchor[0]) * cell;
        const by = cy + (p.minRow + p.hCells / 2 - p.anchor[1]) * cell;
        const bw = p.wCells * cell, bh = p.hCells * cell;
        cc.drawImage(scene, wantX, wantY, wantW, wantH, bx - bw / 2, by - bh / 2, bw, bh);
      });

      // 采样到板面网格
      const home = { x: layout.boardX + p.anchor[0] * cell, y: layout.boardY + p.anchor[1] * cell };
      for (let j = 0; j < N; j++) for (let kk = 0; kk < N; kk++) {
        const boardX = layout.boardX + (boardW * (kk + 0.5)) / N;
        const boardY = layout.boardY + (boardH * (j + 0.5)) / N;
        const lx = boardX - home.x, ly = boardY - home.y;
        const bx = cx + lx, by = cy + ly;
        if (bx < 0 || by < 0 || bx >= bmpW || by >= bmpH) continue;
        if (!inPoly(bx, by, poly)) continue;
        const i = (Math.round(by) * bmpW + Math.round(bx)) * 4;
        bufNow[j * N + kk] = 0.299 * dNow[i] + 0.587 * dNow[i + 1] + 0.114 * dNow[i + 2];
        bufFix[j * N + kk] = 0.299 * dFix[i] + 0.587 * dFix[i + 1] + 0.114 * dFix[i + 2];
      }
    }
    const sc = [];
    for (let j = 0; j < N; j++) for (let kk = 0; kk < N; kk++) {
      const tx = Math.round(((kk + 0.5) / N) * pw), ty = Math.round(((j + 0.5) / N) * ph);
      sc.push(0.299 * sd[(ty * pw + tx) * 4] + 0.587 * sd[(ty * pw + tx) * 4 + 1] + 0.114 * sd[(ty * pw + tx) * 4 + 2]);
    }
    const corr = (a, b) => {
      const ma = a.reduce((s, v) => s + v, 0) / a.length, mb = b.reduce((s, v) => s + v, 0) / b.length;
      let s = 0, na = 0, nb = 0;
      for (let i = 0; i < a.length; i++) { const x = a[i] - ma, y = b[i] - mb; s += x * y; na += x * x; nb += y * y; }
      return +(s / Math.sqrt(na * nb)).toFixed(3);
    };
    res.push({ lv: lv.id, name: lv.name, corrNow: corr(Array.from(bufNow), sc), corrFix: corr(Array.from(bufFix), sc) });
  }
  return res;
});
console.log('关  关卡名       现状相关  修正后相关');
for (const r of out) console.log(`L${r.lv}  ${r.name.padEnd(10)} ${String(r.corrNow).padStart(8)}  ${String(r.corrFix).padStart(9)}`);

/* 角色完整头部图 */
const maps = await page.evaluate(() => {
  const mod = window.__P;
  const kinds = ['dog', 'cat', 'rabbit', 'penguin', 'panda', 'chick'];
  const pals = ['meadow', 'sunny', 'lilac', 'polar', 'bamboo', 'aqua'];
  const out = {};
  for (let i = 0; i < kinds.length; i++) {
    const w = 400, h = 400;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    mod.drawScene(c.getContext('2d'), w, h, kinds[i], pals[i]);
    const d = c.getContext('2d').getImageData(0, 0, w, h).data;
    const g = (x, y) => { const q = (y * w + x) * 4; return 0.299 * d[q] + 0.587 * d[q + 1] + 0.114 * d[q + 2]; };
    const ground = h * 0.87, unit = Math.min((ground - h * 0.05) / 200, (w * 0.56) / 130), x0 = w / 2 - 100 * unit;
    const map = [];
    const ramp = ' .:-=+*#%@';
    for (let gy = 0; gy < 30; gy++) {
      let line = '';
      for (let gx = 0; gx < 58; gx++) {
        const dx = 25 + (150 * (gx + 0.5)) / 58, dy = 5 + (135 * (gy + 0.5)) / 30;
        const px = Math.round(x0 + dx * unit), py = Math.round(ground - (190 - dy) * unit);
        if (px < 0 || py < 0 || px >= w || py >= h) { line += ' '; continue; }
        line += ramp[Math.min(9, Math.max(0, Math.floor((255 - g(px, py)) / 25.6)))];
      }
      map.push(line);
    }
    out[kinds[i]] = map;
  }
  return out;
});
for (const [k, m] of Object.entries(maps)) {
  console.log(`\n--- ${k} 头部（含五官，@=最暗 .=最亮） ---`);
  for (const l of m) console.log('  ' + l);
}
await browser.close();
