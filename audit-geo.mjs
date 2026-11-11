/**
 * 全关卡几何审计 + 用户截图底部裁切实证
 * 1) 6 关 × 2 视口：拼块是否越出画布底边/右边（被裁切）
 * 2) 用户提供的 3 张截图：底部像素取证（拼块是否被水平切断）
 */
import { chromium } from '/Users/zenghuanjia/.workbuddy/binaries/node/workspace/node_modules/playwright/index.mjs';
import { decodePNG, px, lum } from './png.mjs';
import { buildLevel, computeLayout } from './puzzle-parts.js';

const ROOT = '/Users/zenghuanjia/WorkBuddy/2026-11-11-10-31-19/';
const FILE = 'file://' + ROOT + '拼图乐园.html';
const LEVELS = [
  { id: 1, kind: 'dog', name: '小狗豆豆', cols: 2, rows: 1, cells: [[0, 1]] },
  { id: 2, kind: 'cat', name: '小猫团子', cols: 1, rows: 2, cells: [[0], [1]] },
  { id: 3, kind: 'rabbit', name: '小兔奶糖', cols: 2, rows: 2, cells: [[0, 1], [2, 2]] },
  { id: 4, kind: 'penguin', name: '企鹅冰冰', cols: 2, rows: 2, cells: [[0, 1], [0, 2]] },
  { id: 5, kind: 'panda', name: '熊猫圆圆', cols: 2, rows: 2, cells: [[0, 1], [2, 3]] },
  { id: 6, kind: 'chick', name: '小鸡啾啾', cols: 3, rows: 2, cells: [[0, 0, 1], [2, 3, 3]] },
];
const rot = (u, v, a) => { const c = Math.cos(a), s = Math.sin(a); return [u * c - v * s, u * s + v * c]; };

const browser = await chromium.launch({ channel: 'chrome' });

async function geo(idx, viewport, dsf) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: dsf });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  await page.locator('#levelList .levelCard').nth(idx).click();
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => {
    const cv = document.querySelector('#game');
    const b = cv.getBoundingClientRect();
    return { x: b.left, y: b.top, w: b.width, h: b.height, dpr: window.devicePixelRatio, dbg: window.__debug() };
  });
  await page.close();
  return { ...r, errs };
}

/* ========== 1) 全关卡 × 多视口 裁切审计 ========== */
console.log('=== 全关卡几何审计：拼块是否越出画布（被裁切）===');
const VIEWS = [
  { name: '桌面 900x780', vp: { width: 900, height: 780 }, dsf: 1 },
  { name: '桌面 1280x800', vp: { width: 1280, height: 800 }, dsf: 1 },
  { name: '手机 390x844@2', vp: { width: 390, height: 844 }, dsf: 2 },
  { name: '平板 768x1024', vp: { width: 768, height: 1024 }, dsf: 2 },
  { name: '小窗 800x600', vp: { width: 800, height: 600 }, dsf: 1 },
];
for (const v of VIEWS) {
  console.log(`\n--- 视口 ${v.name} ---`);
  for (let i = 0; i < 6; i++) {
    const r = await geo(i, v.vp, v.dsf);
    const lv = LEVELS[i];
    const built = buildLevel(lv, lv.id);
    const layout = computeLayout(built.pieces, lv.cols, lv.rows, r.w, r.h, { margin: 14, trayGap: 18, maxCell: 168, minCell: 48 });
    const slots = layout.slots;
    let worstBottom = 0, worstRight = 0, worstLeft = 0, overCount = 0;
    for (const d of r.dbg) {
      const p = built.pieces[d.id];
      const slot = slots.find((s) => s.index === d.id);
      const a = slot ? slot.angle : 0;
      let bot = -Infinity, rt = -Infinity, lf = Infinity;
      for (const [u, v] of p.poly) {
        const [x, y] = rot(u * layout.cell, v * layout.cell, a);
        bot = Math.max(bot, d.y + y); rt = Math.max(rt, d.x + x); lf = Math.min(lf, d.x + x);
      }
      worstBottom = Math.max(worstBottom, bot - r.h);
      worstRight = Math.max(worstRight, rt - r.w);
      worstLeft = Math.max(worstLeft, -lf);
      if (bot > r.h || rt > r.w || lf < 0) overCount++;
    }
    const cell = layout.cell;
    const flag = worstBottom > 0 ? `❌ 底部溢出 ${worstBottom.toFixed(0)}px (${(worstBottom / cell * 100).toFixed(0)}% 格)` :
      worstRight > 0 ? `❌ 右侧溢出 ${worstRight.toFixed(0)}px` : worstLeft > 0 ? `❌ 左侧溢出 ${worstLeft.toFixed(0)}px` : '✅ 全部在画布内';
    console.log(`  第${lv.id}关 ${lv.name.padEnd(6)} cell=${cell.toFixed(0)} 托盘顶=${layout.trayTop.toFixed(0)} 画布高=${r.h.toFixed(0)} 越界块数=${overCount} ${flag}`);
  }
}

/* ========== 2) 用户截图底部裁切实证 ========== */
console.log('\n\n=== 用户提供的 3 张截图：底部像素取证 ===');
const sat = ([r, g, b]) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx ? (mx - mn) / mx : 0; };
for (const f of ['shots-2-level1.png', 'shots-3-level6.png', 'shots-5-mobile.png']) {
  const img = decodePNG(ROOT + f);
  console.log(`\n--- ${f} (${img.w}x${img.h}) ---`);
  // 逐行统计「图形内容」像素数（排除背景渐变与纯白板面）
  const rows = [];
  for (let y = img.h - 60; y < img.h; y++) {
    let cnt = 0, satSum = 0;
    for (let x = 0; x < img.w; x++) {
      const c = px(img, x, y);
      const s = sat(c);
      satSum += s;
      if (s > 0.14 || lum(c) < 205) cnt++;
    }
    rows.push({ y, cnt, avgSat: satSum / img.w });
  }
  for (const r of rows) {
    const bar = '#'.repeat(Math.min(60, Math.round(r.cnt / img.w * 60)));
    console.log(`  y=${String(r.y).padStart(4)} 内容像素=${String(r.cnt).padStart(4)} (${(r.cnt / img.w * 100).toFixed(1).padStart(5)}%) 平均饱和=${r.avgSat.toFixed(3)} ${bar}`);
  }
}
await browser.close();
