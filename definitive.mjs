/**
 * 阶段 F（决定性验证）：
 *  A) 每块拼块贴图内「透明/空图」像素占比 → 证明美术是否真的画上了
 *  B) 实际取样源矩形 vs 应有源矩形
 *  C) 归位后画布与参考图的相关匹配（修正画布像素坐标换算）
 *  D) 角色头部亮度 ASCII 地图（用于「目视」五官）
 */
import { chromium } from '/Users/zenghuanjia/.workbuddy/binaries/node/workspace/node_modules/playwright/index.mjs';
import { readFileSync } from 'fs';

const ROOT = '/Users/zenghuanjia/WorkBuddy/2026-11-11-10-31-19/';
const FILE = 'file://' + ROOT + '拼图乐园.html';
const partsSrc = readFileSync(ROOT + 'puzzle-parts.js', 'utf8').replace(/^\s*import\s+[^;]+;\s*$/gm, '').replace(/^\s*export\s+(const|function|let|var|class)\s/gm, '$1 ').replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, '');
const charsSrc = readFileSync(ROOT + 'characters.js', 'utf8').replace(/^\s*import\s+[^;]+;\s*$/gm, '').replace(/^\s*export\s+(const|function|let|var|class)\s/gm, '$1 ').replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, '');
const inject = `${partsSrc}\n${charsSrc}\nwindow.__P={LEVELS,buildLevel,computeLayout,drawScene,drawThumb};`;
const browser = await chromium.launch({ channel: 'chrome' });

/* ============ A + B ============ */
{
  const page = await browser.newPage({ viewport: { width: 900, height: 780 } });
  await page.addInitScript(inject);
  await page.goto(FILE); await page.waitForTimeout(700);
  const r = await page.evaluate(() => {
    const mod = window.__P, out = [];
    for (const lv of mod.LEVELS) {
      const built = mod.buildLevel(lv, lv.id);
      const layout = mod.computeLayout(built.pieces, lv.cols, lv.rows, 900, 780, { margin: 14, trayGap: 18, maxCell: 168, minCell: 48 });
      const pw = 512, ph = Math.round(pw * (lv.rows / lv.cols));
      const scene = document.createElement('canvas'); scene.width = pw; scene.height = ph;
      mod.drawScene(scene.getContext('2d'), pw, ph, lv.kind, lv.pal);
      const cell = layout.cell, cellInScene = pw / lv.cols, k = cell / cellInScene;
      for (const p of built.pieces) {
        const bmpW = Math.ceil(cell * 2.4), bmpH = bmpW;
        const srcX = (p.anchor[0] / lv.cols) * pw, srcY = (p.anchor[1] / lv.rows) * ph;
        const bmp = document.createElement('canvas'); bmp.width = bmpW; bmp.height = bmpH;
        const bc = bmp.getContext('2d');
        const cx = bmpW / 2, cy = bmpH / 2;
        const poly = p.poly.map((pt) => [cx + pt[0] * cell, cy + pt[1] * cell]);
        bc.save(); bc.beginPath();
        poly.forEach((pt, i) => (i === 0 ? bc.moveTo(pt[0], pt[1]) : bc.lineTo(pt[0], pt[1])));
        bc.closePath(); bc.clip();
        bc.drawImage(scene, srcX - (bmpW / 2) / k, srcY - (bmpH / 2) / k, bmpW / k, bmpH / k);
        bc.restore();
        const d = bc.getImageData(0, 0, bmpW, bmpH).data;
        let inN = 0, transparent = 0, opaque = 0;
        const inPoly = (x, y, pts) => { let ins = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const [xi, yi] = pts[i], [xj, yj] = pts[j];
          if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins; } return ins; };
        for (let y = 0; y < bmpH; y++) for (let x = 0; x < bmpW; x++) {
          if (!inPoly(x, y, poly)) continue;
          inN++;
          const a = d[(y * bmpW + x) * 4 + 3];
          if (a < 20) transparent++; else opaque++;
        }
        // 实际取样：源图被整体缩放绘制（5 参 drawImage），覆盖的源矩形
        const usedScale = (bmpW / k) / pw;
        const usedSrc = { x: srcX - (bmpW / 2) / k, y: srcY - (bmpH / 2) / k, w: bmpW / k, h: bmpH / k };
        // 正确取样：本块在场景中的包围盒
        const wantSrc = {
          x: (p.minCol) * cellInScene, y: p.minRow * (ph / lv.rows),
          w: p.wCells * cellInScene, h: p.hCells * (ph / lv.rows),
        };
        out.push({
          lv: lv.id, id: p.id, cells: p.cells.map((c) => c.join('')).join('/'),
          inN, transparentPct: +(transparent / inN * 100).toFixed(1),
          usedScale: +usedScale.toFixed(3), wantScale: +k.toFixed(3),
          usedSrc: [usedSrc.x, usedSrc.y, usedSrc.w, usedSrc.h].map((v) => +v.toFixed(0)),
          wantSrc: [wantSrc.x, wantSrc.y, wantSrc.w, wantSrc.h].map((v) => +v.toFixed(0)),
          sceneSize: [pw, ph],
        });
      }
    }
    return out;
  });
  console.log('=== A/B 拼块贴图取样与空白率 ===');
  console.log('关  块  形状     空白%   用比例/应比例   实际取样矩形(x,y,w,h)   应有矩形(x,y,w,h)   场景尺寸');
  for (const x of r) console.log(`L${x.lv} id${x.id} ${String(x.cells).padEnd(8)} ${String(x.transparentPct).padStart(5)}  ${String(x.usedScale).padStart(5)}/${String(x.wantScale).padEnd(6)} ${JSON.stringify(x.usedSrc).padEnd(23)} ${JSON.stringify(x.wantSrc).padEnd(23)} ${x.sceneSize}`);
  await page.close();
}

/* ============ C ============ */
async function corrCheck(idx) {
  const page = await browser.newPage({ viewport: { width: 900, height: 780 } });
  await page.addInitScript(inject);
  await page.goto(FILE); await page.waitForTimeout(800);
  await page.locator('#levelList .levelCard').nth(idx).click();
  await page.waitForTimeout(1000);
  for (let i = 0; i < 8; i++) {
    const info = await page.evaluate(() => { const p = window.__debug().find((q) => !q.placed); return p ? { x: p.x, y: p.y, hx: p.home.x, hy: p.home.y } : null; });
    if (!info) break;
    await page.mouse.move(info.x, info.y); await page.mouse.down();
    await page.mouse.move(info.hx, info.hy, { steps: 20 }); await page.mouse.up();
    await page.waitForTimeout(230);
  }
  await page.waitForTimeout(800);
  const res = await page.evaluate((i) => {
    const mod = window.__P, lv = mod.LEVELS[i];
    const built = mod.buildLevel(lv, lv.id);
    const layout = mod.computeLayout(built.pieces, lv.cols, lv.rows, 900, 780, { margin: 14, trayGap: 18, maxCell: 168, minCell: 48 });
    const pw = 512, ph = Math.round(pw * (lv.rows / lv.cols));
    const scene = document.createElement('canvas'); scene.width = pw; scene.height = ph;
    mod.drawScene(scene.getContext('2d'), pw, ph, lv.kind, lv.pal);
    const sd = scene.getContext('2d').getImageData(0, 0, pw, ph).data;
    const cv = document.querySelector('#game'), ctx = cv.getContext('2d'), dpr = window.devicePixelRatio;
    const cd = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const canvasTopPageY = cv.getBoundingClientRect().y;   // 画布在页面中的顶部
    const gray = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const N = 48, canvasSamples = [], sceneSamples = [];
    for (let j = 0; j < N; j++) for (let k = 0; k < N; k++) {
      const pageX = layout.boardX + (layout.boardW * (k + 0.5)) / N;
      const pageY = canvasTopPageY + layout.boardY + (layout.boardH * (j + 0.5)) / N;
      const sx = Math.round(pageX * dpr), sy = Math.round(pageY * dpr);
      if (sx < 0 || sy < 0 || sx >= cv.width || sy >= cv.height) { canvasSamples.push(0); continue; }
      canvasSamples.push(gray(cd, (sy * cv.width + sx) * 4));
      const tx = Math.round(((k + 0.5) / N) * pw), ty = Math.round(((j + 0.5) / N) * ph);
      sceneSamples.push(gray(sd, (ty * pw + tx) * 4));
    }
    const norm = (a) => { const m = a.reduce((s, v) => s + v, 0) / a.length; return a.map((v) => v - m); };
    const corr = (a, b) => { const A = norm(a), B = norm(b); let s = 0, na = 0, nb = 0;
      for (let i = 0; i < A.length; i++) { s += A[i] * B[i]; na += A[i] * A[i]; nb += B[i] * B[i]; } return +(s / Math.sqrt(na * nb)).toFixed(3); };
    const mirX = sceneSamples.map((_, k) => { const j = Math.floor(k / N), kk = k % N; return sceneSamples[j * N + (N - 1 - kk)]; });
    return { lv: lv.id, name: lv.name, normal: corr(canvasSamples, sceneSamples), mirrorX: corr(canvasSamples, mirX),
      meanCanvas: +(canvasSamples.reduce((s, v) => s + v, 0) / canvasSamples.length).toFixed(1),
      meanScene: +(sceneSamples.reduce((s, v) => s + v, 0) / sceneSamples.length).toFixed(1),
      canvasTopPageY, cvH: cv.height, cvHcss: cv.height / dpr, boardYcss: layout.boardY };
  }, idx);
  await page.close();
  return res;
}
console.log('\n=== C 归位后画布 vs 参考图 ===');
for (const i of [0, 2, 5]) {
  const r = await corrCheck(i);
  console.log(`L${r.lv} ${r.name}: corr正常=${r.normal} corr镜像X=${r.mirrorX} 画布均亮=${r.meanCanvas} 参考均亮=${r.meanScene} 画布顶(页面)=${r.canvasTopPageY} 画布高=${r.cvHcss} 板面y=${r.boardYcss}`);
}

/* ============ D 角色头部 ASCII 地图 ============ */
{
  const page = await browser.newPage({ viewport: { width: 400, height: 400 } });
  await page.addInitScript(inject);
  await page.goto(FILE); await page.waitForTimeout(500);
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
      // 头部区域（设计坐标 x 30..170, y 20..140）→ 画布
      const map = [];
      const ramp = ' .:-=+*#%@';
      for (let gy = 0; gy < 26; gy++) {
        let line = '';
        for (let gx = 0; gx < 56; gx++) {
          const dx = 30 + (140 * (gx + 0.5)) / 56, dy = 20 + (120 * (gy + 0.5)) / 26;
          const px = Math.round(x0 + dx * unit), py = Math.round(ground - (190 - dy) * unit);
          if (px < 0 || py < 0 || px >= w || py >= h) { line += ' '; continue; }
          const L = g(px, py);
          line += ramp[Math.min(9, Math.max(0, Math.floor((255 - L) / 25.6)))];
        }
        map.push(line);
      }
      out[kinds[i]] = map;
    }
    return out;
  });
  for (const [k, m] of Object.entries(maps)) {
    console.log(`\n--- ${k} 头部亮度图 (@=暗 .=亮) ---`);
    for (const l of m) console.log('   ' + l);
  }
  await page.close();
}
await browser.close();
