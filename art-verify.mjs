/**
 * 阶段 D（美术配准验证）：
 * 验证「拼块贴图是否真的显示对应角色的正确区域」，
 * 以及「把拼块放回凹槽后能否与目标板参考图对齐」。
 */
import { chromium } from '/Users/zenghuanjia/.workbuddy/binaries/node/workspace/node_modules/playwright/index.mjs';
import { readFileSync } from 'fs';

const ROOT = '/Users/zenghuanjia/WorkBuddy/2026-11-11-10-31-19/';
const FILE = 'file://' + ROOT + '拼图乐园.html';

const partsSrc = readFileSync(ROOT + 'puzzle-parts.js', 'utf8')
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+(const|function|let|var|class)\s/gm, '$1 ')
  .replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, '');
const charsSrc = readFileSync(ROOT + 'characters.js', 'utf8')
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+(const|function|let|var|class)\s/gm, '$1 ')
  .replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, '');

const inject = `
${partsSrc}
${charsSrc}
window.__P = { LEVELS, buildLevel, computeLayout, pointInPoly, lerp, clamp, drawScene, drawThumb };
`;

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 900, height: 780 } });
await page.addInitScript(inject);
await page.goto(FILE);
await page.waitForTimeout(900);

const report = await page.evaluate(() => {
  const mod = window.__P;
  const res = [];

  for (let li = 0; li < mod.LEVELS.length; li++) {
    const lv = mod.LEVELS[li];
    const built = mod.buildLevel(lv, lv.id);
    const W = 900, H = 780;
    const layout = mod.computeLayout(built.pieces, lv.cols, lv.rows, W, H,
      { margin: 14, trayGap: 18, maxCell: 168, minCell: 48 });

    const pw = 512, ph = Math.round(pw * (lv.rows / lv.cols));
    const scene = document.createElement('canvas'); scene.width = pw; scene.height = ph;
    mod.drawScene(scene.getContext('2d'), pw, ph, lv.kind, lv.pal);
    const sdata = scene.getContext('2d').getImageData(0, 0, pw, ph).data;

    const cell = layout.cell;
    const cellInScene = pw / lv.cols;
    const k = cell / cellInScene;

    for (const p of built.pieces) {
      const bmpW = Math.ceil(cell * 2.4), bmpH = bmpW;
      const srcX = (p.anchor[0] / lv.cols) * pw;
      const srcY = (p.anchor[1] / lv.rows) * ph;
      // 复刻 renderPieceBitmap 的 5 参 drawImage（整图缩放，非裁剪）
      const scale = (bmpW / k) / pw;
      const dx0 = srcX - (bmpW / 2) / k;
      const dy0 = srcY - (bmpH / 2) / k;

      const cx = bmpW / 2, cy = bmpH / 2;
      const poly = p.poly.map((pt) => [cx + pt[0] * cell, cy + pt[1] * cell]);

      const bmp = document.createElement('canvas'); bmp.width = bmpW; bmp.height = bmpH;
      const bc = bmp.getContext('2d');
      bc.save();
      bc.beginPath();
      poly.forEach((pt, i) => (i === 0 ? bc.moveTo(pt[0], pt[1]) : bc.lineTo(pt[0], pt[1])));
      bc.closePath(); bc.clip();
      bc.drawImage(scene, dx0, dy0, bmpW / k, bmpH / k);
      bc.restore();
      const bd = bc.getImageData(0, 0, bmpW, bmpH).data;

      const inPoly = (x, y, pts) => { let ins = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins; } return ins; };

      let n = 0, sumAbsCorrect = 0, sumAbsSampled = 0;
      for (let y = 4; y < bmpH; y += 3) for (let x = 4; x < bmpW; x += 3) {
        if (!inPoly(x, y, poly)) continue;
        const i = (y * bmpW + x) * 4;
        const actual = [bd[i], bd[i + 1], bd[i + 2]];
        const ax = (x - dx0) / scale, ay = (y - dy0) / scale;
        const unitX = p.anchor[0] + (x - cx) / cell;
        const unitY = p.anchor[1] + (y - cy) / cell;
        const csx = Math.round(unitX * cellInScene), csy = Math.round(unitY * (ph / lv.rows));
        if (csx < 0 || csx >= pw || csy < 0 || csy >= ph) continue;
        const ci = (csy * pw + csx) * 4;
        const correct = [sdata[ci], sdata[ci + 1], sdata[ci + 2]];
        sumAbsCorrect += Math.abs(actual[0] - correct[0]) + Math.abs(actual[1] - correct[1]) + Math.abs(actual[2] - correct[2]);
        n++;
        if (ax >= 0 && ax < pw && ay >= 0 && ay < ph) {
          const ai = (Math.round(ay) * pw + Math.round(ax)) * 4;
          sumAbsSampled += Math.abs(actual[0] - sdata[ai]) + Math.abs(actual[1] - sdata[ai + 1]) + Math.abs(actual[2] - sdata[ai + 2]);
        }
      }
      const actualAnchorSceneX = (cx - dx0) / scale;
      const actualAnchorSceneY = (cy - dy0) / scale;
      res.push({
        level: lv.id, name: lv.name, pieceId: p.id, cells: p.cells.map((c) => c.join('')).join('/'),
        cell: +cell.toFixed(1),
        scaleUsed: +scale.toFixed(3), scaleIntended: +k.toFixed(3),
        actualAnchor: [+actualAnchorSceneX.toFixed(1), +actualAnchorSceneY.toFixed(1)],
        correctAnchor: [+(p.anchor[0] * cellInScene).toFixed(1), +(p.anchor[1] * (ph / lv.rows)).toFixed(1)],
        offsetCells: [+((actualAnchorSceneX - p.anchor[0] * cellInScene) / cellInScene).toFixed(2),
                      +((actualAnchorSceneY - p.anchor[1] * (ph / lv.rows)) / (ph / lv.rows)).toFixed(2)],
        diffVsCorrect: +(sumAbsCorrect / (n || 1)).toFixed(1),
        diffVsSampled: +(sumAbsSampled / (n || 1)).toFixed(1),
      });
    }
  }
  return res;
});

console.log('关  块  形状      scale用/应为   实际锚点(场景px)  正确锚点        偏移(格)      差vs正确  差vs取样');
for (const r of report) {
  console.log(`L${r.level}  id${r.pieceId}  ${String(r.cells).padEnd(9)} ${String(r.scaleUsed).padStart(5)}/${String(r.scaleIntended).padEnd(6)} ${JSON.stringify(r.actualAnchor).padEnd(17)} ${JSON.stringify(r.correctAnchor).padEnd(15)} ${JSON.stringify(r.offsetCells).padEnd(15)} ${String(r.diffVsCorrect).padStart(6)}   ${r.diffVsSampled}`);
}
await browser.close();
