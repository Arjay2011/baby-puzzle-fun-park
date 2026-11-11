/**
 * 阶段 J（直接可视化）：把每块拼块贴图渲染成 ASCII 地图 + 目标板虚线槽地图
 * 以此"直接看到"块上究竟画了什么
 */
import { chromium } from '/Users/zenghuanjia/.workbuddy/binaries/node/workspace/node_modules/playwright/index.mjs';
import { readFileSync } from 'fs';

const ROOT = '/Users/zenghuanjia/WorkBuddy/2026-11-11-10-31-19/';
const FILE = 'file://' + ROOT + '拼图乐园.html';
const partsSrc = readFileSync(ROOT + 'puzzle-parts.js', 'utf8').replace(/^\s*import\s+[^;]+;\s*$/gm, '').replace(/^\s*export\s+(const|function|let|var|class)\s/gm, '$1 ').replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, '');
const charsSrc = readFileSync(ROOT + 'characters.js', 'utf8').replace(/^\s*import\s+[^;]+;\s*$/gm, '').replace(/^\s*export\s+(const|function|let|var|class)\s/gm, '$1 ').replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, '');
const inject = `${partsSrc}\n${charsSrc}\nwindow.__P={LEVELS,buildLevel,computeLayout,drawScene};`;
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 900, height: 780 } });
await page.addInitScript(inject);
await page.goto(FILE); await page.waitForTimeout(700);

const out = await page.evaluate(() => {
  const mod = window.__P, res = [];
  const ramp = ' .:-=+*#%@';
  for (const idx of [0, 5]) {
    const lv = mod.LEVELS[idx];
    const built = mod.buildLevel(lv, lv.id);
    const layout = mod.computeLayout(built.pieces, lv.cols, lv.rows, 900, 780, { margin: 14, trayGap: 18, maxCell: 168, minCell: 48 });
    const pw = 512, ph = Math.round(pw * (lv.rows / lv.cols));
    const scene = document.createElement('canvas'); scene.width = pw; scene.height = ph;
    mod.drawScene(scene.getContext('2d'), pw, ph, lv.kind, lv.pal);
    const cell = layout.cell, cellInScene = pw / lv.cols, k = cell / cellInScene;

    // 整幅场景 ASCII（用颜色字母区分：蓝=天空 绿=草 黄=角色 白=高光）
    const sd = scene.getContext('2d').getImageData(0, 0, pw, ph).data;
    const sceneMap = [];
    for (let gy = 0; gy < 16; gy++) {
      let line = '';
      for (let gx = 0; gx < 60; gx++) {
        const x = Math.round(((gx + 0.5) / 60) * pw), y = Math.round(((gy + 0.5) / 16) * ph);
        const i = (y * pw + x) * 4;
        const [r, g, b] = [sd[i], sd[i + 1], sd[i + 2]];
        const L = 0.299 * r + 0.587 * g + 0.114 * b;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const sat = mx ? (mx - mn) / mx : 0;
        let ch;
        if (sat < 0.10) ch = L > 235 ? '.' : L > 200 ? ',' : ':';
        else if (g > r && g > b) ch = g > 190 ? 'g' : 'G';
        else if (b > r && b > g) ch = '~';
        else if (r > 200 && g > 170 && b < 140) ch = 'Y';
        else if (r > 150 && g > 90 && b < 110) ch = 'M';
        else ch = '#';
        line += ch;
      }
      sceneMap.push(line);
    }

    const pieces = [];
    built.pieces.forEach((p, i) => {
      const bmpW = Math.ceil(cell * 2.4), bmpH = bmpW;
      const srcX = (p.anchor[0] / lv.cols) * pw, srcY = (p.anchor[1] / lv.rows) * ph;
      const c = document.createElement('canvas'); c.width = bmpW; c.height = bmpH;
      const cc = c.getContext('2d');
      const cx = bmpW / 2, cy = bmpH / 2;
      const poly = p.poly.map((pt) => [cx + pt[0] * cell, cy + pt[1] * cell]);
      cc.save(); cc.beginPath();
      poly.forEach((pt, j) => (j === 0 ? cc.moveTo(pt[0], pt[1]) : cc.lineTo(pt[0], pt[1])));
      cc.closePath(); cc.clip();
      cc.drawImage(scene, srcX - (bmpW / 2) / k, srcY - (bmpH / 2) / k, bmpW / k, bmpH / k);
      cc.restore();
      const d = cc.getImageData(0, 0, bmpW, bmpH).data;
      const inPoly = (x, y, pts) => { let ins = false; for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) {
        const [xi, yi] = pts[a], [xj, yj] = pts[b];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins; } return ins; };
      const map = [];
      for (let gy = 0; gy < 15; gy++) {
        let line = '';
        for (let gx = 0; gx < 30; gx++) {
          const x = Math.round(((gx + 0.5) / 30) * bmpW), y = Math.round(((gy + 0.5) / 15) * bmpH);
          if (!inPoly(x, y, poly)) { line += ' '; continue; }
          const i = (y * bmpW + x) * 4;
          const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
          const alpha = d[i + 3];
          if (alpha < 20) { line += ' '; continue; }
          const L = 0.299 * r + 0.587 * g + 0.114 * b;
          const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
          const sat = mx ? (mx - mn) / mx : 0;
          let ch;
          if (sat < 0.10) ch = L > 235 ? '.' : L > 200 ? ',' : ':';
          else if (g > r && g > b) ch = g > 190 ? 'g' : 'G';
          else if (b > r && b > g) ch = '~';
          else if (r > 200 && g > 170 && b < 140) ch = 'Y';
          else if (r > 150 && g > 90 && b < 110) ch = 'M';
          else ch = '#';
          line += ch;
        }
        map.push(line);
      }
      pieces.push({ id: p.id, cells: p.cells.map((x) => x.join('')).join('/'), map });
    });
    res.push({ level: lv.id, name: lv.name, sceneMap, pieces });
  }
  return res;
});

for (const r of out) {
  console.log(`\n############ L${r.level} ${r.name} 完整场景图 (.=天空白 ~=蓝 M=棕 Y=黄 gG=绿 #=其他) ############`);
  for (const l of r.sceneMap) console.log('  ' + l);
  for (const p of r.pieces) {
    console.log(`\n  --- 拼块 id${p.id} (格 ${p.cells}) 实际贴图内容 ---`);
    for (const l of p.map) console.log('    ' + l);
  }
}
await browser.close();
