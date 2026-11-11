/**
 * 终检补充：
 *  A) 端到端：第 1 关能否拖拽通关（孩子真的能玩）
 *  B) 手机左缘是否也被切
 *  C) 第 6 关桌面：被切的到底是哪块（对照 __debug）
 */
import { decodePNG, px, lum } from './png.mjs';
import { chromium } from '/Users/zenghuanjia/.workbuddy/binaries/node/workspace/node_modules/playwright/index.mjs';
import { buildLevel, computeLayout } from './puzzle-parts.js';

const ROOT = '/Users/zenghuanjia/WorkBuddy/2026-11-11-10-31-19/';
const FILE = 'file://' + ROOT + '拼图乐园.html';
const browser = await chromium.launch({ channel: 'chrome' });

/* ===== A) 端到端通关 ===== */
for (const [idx, name, vp, dsf] of [[0, '第1关 小狗', { width: 900, height: 780 }, 1], [5, '第6关 小鸡', { width: 900, height: 780 }, 1], [0, '第1关 手机', { width: 390, height: 844 }, 2]]) {
  const page = await browser.newPage({ viewport: vp, deviceScaleFactor: dsf });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  await page.locator('#levelList .levelCard').nth(idx).click();
  await page.waitForTimeout(800);
  let moves = 0;
  for (let i = 0; i < 8; i++) {
    const info = await page.evaluate(() => {
      const p = window.__debug().find((q) => !q.placed);
      return p ? { x: p.x, y: p.y, hx: p.home.x, hy: p.home.y } : null;
    });
    if (!info) break;
    await page.mouse.move(info.x, info.y);
    await page.mouse.down();
    await page.mouse.move(info.hx, info.hy, { steps: 15 });
    await page.mouse.up();
    await page.waitForTimeout(260);
    moves++;
  }
  await page.waitForTimeout(1200);
  const done = await page.evaluate(() => ({
    completeVisible: !document.querySelector('#complete').classList.contains('hidden'),
    title: document.querySelector('#winTitle')?.textContent,
    stars: [...document.querySelectorAll('#winStars .wstar.on')].length,
    placed: window.__debug().filter((p) => p.placed).length,
    total: window.__debug().length,
  }));
  console.log(`A) ${name}: 拖拽 ${moves} 次 → 已归位 ${done.placed}/${done.total}  结算面板=${done.completeVisible ? `✅ 显示("${done.title}" ${done.stars}星)` : '❌ 未显示'}  JS错误=${errs.length ? errs.join('|') : '无'}`);
  await page.close();
}

/* ===== B) 手机左缘 ===== */
{
  const shot = decodePNG(ROOT + 'shots-5-mobile.png');
  console.log('\nB) shots-5-mobile.png 左缘采样');
  for (const y of [200, 600, 1000, 1200, 1400]) {
    const cols = [];
    for (const x of [0, 1, 2, 10, 30, 60, 100]) cols.push(`x${x}=(${px(shot, x, y).join(',')})`);
    console.log(`  y=${y}: ${cols.join(' ')}`);
  }
  let diff = 0, same = 0, y0 = -1, y1 = -1;
  for (let y = 168; y < shot.h; y++) {
    const a = px(shot, 0, y), b = px(shot, 200, y);
    const d = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
    if (d >= 12) { diff++; if (y0 < 0) y0 = y; y1 = y; } else same++;
  }
  console.log(`  左缘列 vs x=200：不同行=${diff} 相同行=${same} → ${diff > 300 ? '⚠️ 左缘也有图形内容（拼块被左边缘切）' : '✅ 左缘是背景'}`);
  if (y0 >= 0) {
    let wh = 0;
    for (let y = y0; y <= y1; y++) { const c = px(shot, 0, y); if (c[0] > 244 && c[1] > 244 && c[2] > 244) wh++; }
    console.log(`  左缘图形纵向 device ${y0}..${y1}；近白描边=${wh}/${y1 - y0 + 1} → ${wh < 20 ? '❌ 无描边 = 被硬切' : '✅ 有描边'}`);
  }
}

/* ===== C) 第 6 关桌面：哪块被切 ===== */
{
  const page = await browser.newPage({ viewport: { width: 900, height: 780 }, deviceScaleFactor: 1 });
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  await page.locator('#levelList .levelCard').nth(5).click();
  await page.waitForTimeout(800);
  const d = await page.evaluate(() => ({ dbg: window.__debug(), cv: document.querySelector('#game').getBoundingClientRect().toJSON() }));
  await page.close();
  const lv = { id: 6, kind: 'chick', cols: 3, rows: 2, cells: [[0, 0, 1], [2, 3, 3]] };
  const built = buildLevel(lv, lv.id);
  const layout = computeLayout(built.pieces, lv.cols, lv.rows, d.cv.width, d.cv.height, { margin: 14, trayGap: 18, maxCell: 168, minCell: 48 });
  const slots = layout.slots;
  const rot = (u, v, a) => { const c = Math.cos(a), s = Math.sin(a); return [u * c - v * s, u * s + v * c]; };
  console.log('\nC) 第6关桌面 900x780 各块包围盒（画布坐标）');
  for (const x of d.dbg) {
    const p = built.pieces[x.id];
    const slot = slots.find((s) => s.index === x.id);
    const a = slot ? slot.angle : 0;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [u, v] of p.poly) { const [rx, ry] = rot(u * layout.cell, v * layout.cell, a); x0 = Math.min(x0, x.x + rx); x1 = Math.max(x1, x.x + rx); y0 = Math.min(y0, x.y + ry); y1 = Math.max(y1, x.y + ry); }
    console.log(`  块${x.id} (${p.cells.map(c => c.join('')).join('/')}) x=[${x0.toFixed(0)},${x1.toFixed(0)}] y=[${y0.toFixed(0)},${y1.toFixed(0)}]  画布 900x${d.cv.height}  ${y1 > d.cv.height ? `❌ 底部溢出 ${(y1 - d.cv.height).toFixed(0)}px` : '✅'}`);
  }
}
await browser.close();
