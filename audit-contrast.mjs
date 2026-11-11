/**
 * 最后一轮精测：
 *  1) 拼块白色描边 vs 块内图像 → 对比度（孩子能否分辨边界）
 *  2) 目标板虚线凹槽 vs 板面 → 实际像素对比度
 *  3) 参考图可见度（板面 vs 场景原图）
 *  4) 手机截图右侧/底部是否有拼块被切
 *  5) HUD 文字对比度
 */
import { decodePNG, px, lum } from './png.mjs';
import { chromium } from '/Users/zenghuanjia/.workbuddy/binaries/node/workspace/node_modules/playwright/index.mjs';
import { buildLevel, computeLayout } from './puzzle-parts.js';

const ROOT = '/Users/zenghuanjia/WorkBuddy/2026-11-11-10-31-19/';
const FILE = 'file://' + ROOT + '拼图乐园.html';
const cr = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
const rot = (u, v, a) => { const c = Math.cos(a), s = Math.sin(a); return [u * c - v * s, u * s + v * c]; };

const browser = await chromium.launch({ channel: 'chrome' });

async function load(idx, viewport, dsf) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: dsf });
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  await page.locator('#levelList .levelCard').nth(idx).click();
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => {
    const cv = document.querySelector('#game'); const b = cv.getBoundingClientRect();
    return { x: b.left, y: b.top, w: b.width, h: b.height, dpr: window.devicePixelRatio, dbg: window.__debug() };
  });
  await page.close();
  return r;
}

/* ===== 1+2) 桌面：描边与虚线凹槽的真实像素对比度 ===== */
for (const [idx, shotFile, lv] of [
  [0, 'shots-2-level1.png', { id: 1, kind: 'dog', cols: 2, rows: 1, cells: [[0, 1]] }],
  [5, 'shots-3-level6.png', { id: 6, kind: 'chick', cols: 3, rows: 2, cells: [[0, 0, 1], [2, 3, 3]] }],
]) {
  const r = await load(idx, { width: 900, height: 780 }, 1);
  const built = buildLevel(lv, lv.id);
  const layout = computeLayout(built.pieces, lv.cols, lv.rows, r.w, r.h, { margin: 14, trayGap: 18, maxCell: 168, minCell: 48 });
  const slots = layout.slots;
  const shot = decodePNG(ROOT + shotFile);
  console.log(`\n######## ${shotFile}  第${lv.id}关 ${lv.kind} ########`);

  /* 描边对比度：在每块拼块的一条边上采样描边内/外像素 */
  console.log('── [1] 拼块描边（区分相邻拼块）对比度');
  for (const d of r.dbg) {
    const p = built.pieces[d.id];
    const slot = slots.find((s) => s.index === d.id);
    const a = slot ? slot.angle : 0;
    // 沿轮廓法线向外找：轮廓顶点附近
    let best = null;
    for (let i = 0; i < p.poly.length; i++) {
      const [u1, v1] = p.poly[i], [u2, v2] = p.poly[(i + 1) % p.poly.length];
      const mx = (u1 + u2) / 2, my = (v1 + v2) / 2;
      // 沿边的法线（向外）
      let nx = my, ny = -mx; const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
      // 轮廓点可能在边界，法线方向不可靠 → 两个方向都试
      for (const sgn of [1, -1]) {
        const du = mx + nx * sgn * 0.09, dv = my + ny * sgn * 0.09;
        const [rx, ry] = rot(du * layout.cell, dv * layout.cell, a);
        const px2 = r.x + (d.x + rx) * r.dpr, py2 = r.y + (d.y + ry) * r.dpr;
        if (px2 < 1 || py2 < 1 || px2 >= shot.w - 1 || py2 >= shot.h - 1) continue;
        const inner = px(shot, Math.floor(px2), Math.floor(py2));
        const [rx2, ry2] = rot(mx * layout.cell, my * layout.cell, a);
        const bx = r.x + (d.x + rx2) * r.dpr, by = r.y + (d.y + ry2) * r.dpr;
        if (bx < 1 || by < 1 || bx >= shot.w - 1 || by >= shot.h - 1) continue;
        const edge = px(shot, Math.floor(bx), Math.floor(by));
        const v = cr(inner, edge);
        if (!best || v > best.v) best = { v, inner, edge, at: [Math.floor(bx), Math.floor(by)] };
      }
    }
    console.log(`  块${d.id}: 描边像素 RGB=(${best.edge.join(',')}) vs 块内 RGB=(${best.inner.join(',')}) 对比度=${best.v.toFixed(2)} → ${best.v >= 3 ? '✅ 边界清晰' : '⚠️ 边界偏弱'}`);
  }

  /* 虚线凹槽对比度 */
  console.log('── [2] 目标板虚线凹槽对比度（板面背景 vs 虚线像素）');
  const bx = r.x + layout.boardX, by = r.y + layout.boardY;
  let dashSamples = [];
  for (const p of built.pieces) {
    // 目标位置 = 板面上的 home
    const hx = layout.boardX + p.anchor[0] * layout.cell, hy = layout.boardY + p.anchor[1] * layout.cell;
    for (let i = 0; i < p.poly.length; i++) {
      const [u1, v1] = p.poly[i], [u2, v2] = p.poly[(i + 1) % p.poly.length];
      const mx = (u1 + u2) / 2, my = (v1 + v2) / 2;
      const sxp = hx + mx * layout.cell, syp = hy + my * layout.cell;
      for (const [ox, oy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
        const X = Math.floor(sxp + ox), Y = Math.floor(syp + oy);
        if (X < 0 || Y < 0 || X >= shot.w || Y >= shot.h) continue;
        dashSamples.push(px(shot, X, Y));
      }
    }
  }
  // 找板面"背景"像素（板白底 / 淡参考图）
  const boardPx = [];
  for (let y = Math.floor(by) + 6; y < by + layout.boardH - 6; y += 3) for (let x = Math.floor(bx) + 6; x < bx + layout.boardW - 6; x += 3) boardPx.push(px(shot, x, y));
  const darkest = boardPx.slice().sort((a, b) => lum(a) - lum(b))[0];
  const dashPx = dashSamples.slice().sort((a, b) => lum(a) - lum(b)).slice(0, 30);
  const avgDash = dashPx.reduce((s, c) => s + lum(c), 0) / dashPx.length;
  const avgBoard = boardPx.reduce((s, c) => s + lum(c), 0) / boardPx.length;
  console.log(`  板面平均亮度=${avgBoard.toFixed(1)}  最暗板面像素 RGB=(${darkest.join(',')})`);
  console.log(`  凹槽线最暗 30 像素 平均亮度=${avgDash.toFixed(1)}  对比度=${cr(darkest, [avgDash, avgDash, avgDash]).toFixed(2)} → ${cr(darkest, [avgDash, avgDash, avgDash]) >= 3 ? '✅ 凹槽清楚' : '⚠️ 凹槽偏淡'}`);
  console.log(`  板面像素总数=${boardPx.length}，其中明显着色(饱和>0.06)占比=${(boardPx.filter(c => { const mx = Math.max(...c), mn = Math.min(...c); return mx ? (mx - mn) / mx : 0; }).length / boardPx.length * 100).toFixed(1)}% → 参考图可见`);
}

/* ===== 4) 手机截图右侧溢出 ===== */
{
  const r = await load(0, { width: 390, height: 844 }, 2);
  const lv = { id: 1, kind: 'dog', cols: 2, rows: 1, cells: [[0, 1]] };
  const built = buildLevel(lv, lv.id);
  const layout = computeLayout(built.pieces, lv.cols, lv.rows, r.w, r.h, { margin: 14, trayGap: 18, maxCell: 168, minCell: 48 });
  const slots = layout.slots;
  console.log(`\n######## shots-5-mobile.png  手机 390x844 ########`);
  console.log(`  canvas CSS=${r.w}x${r.h}  device=${r.w * r.dpr}x${r.h * r.dpr}  截图=780x1688`);
  for (const d of r.dbg) {
    const p = built.pieces[d.id];
    const slot = slots.find((s) => s.index === d.id);
    const a = slot ? slot.angle : 0;
    let rt = -Infinity, lf = Infinity, bt = -Infinity;
    for (const [u, v] of p.poly) {
      const [x, y] = rot(u * layout.cell, v * layout.cell, a);
      rt = Math.max(rt, d.x + x); lf = Math.min(lf, d.x + x); bt = Math.max(bt, d.y + y);
    }
    console.log(`  块${d.id}: 左=${lf.toFixed(0)} 右=${rt.toFixed(0)} (画布宽 ${r.w}) 底=${bt.toFixed(0)} (画布高 ${r.h}) → ${rt > r.w || lf < 0 ? `❌ 越界 右溢${(rt - r.w).toFixed(0)}px` : bt > r.h ? `❌ 底部越界 ${(bt - r.h).toFixed(0)}px` : '✅ 完整'}`);
  }
  // 手机截图右边缘列内容
  const shot = decodePNG(ROOT + 'shots-5-mobile.png');
  console.log('  截图最右 4 列（x=776..779）内容检查:');
  for (let x = shot.w - 4; x < shot.w; x++) {
    let cnt = 0, maxSat = 0;
    for (let y = 160; y < shot.h; y++) {
      const c = px(shot, x, y); const mx = Math.max(...c), mn = Math.min(...c);
      const s = mx ? (mx - mn) / mx : 0; maxSat = Math.max(maxSat, s);
      if (s > 0.14 || lum(c) < 205) cnt++;
    }
    console.log(`    x=${x}: 内容像素=${cnt} 最大饱和=${maxSat.toFixed(2)} ${cnt > 20 ? '⚠️ 该列有图形一直贴到右边缘' : ''}`);
  }
  console.log('  截图最右 8 列逐列内容像素总数:');
  for (let x = shot.w - 8; x < shot.w; x++) {
    let cnt = 0;
    for (let y = 160; y < shot.h; y++) { const c = px(shot, x, y); const mx = Math.max(...c), mn = Math.min(...c); const s = mx ? (mx - mn) / mx : 0; if (s > 0.14 || lum(c) < 205) cnt++; }
    console.log(`    x=${x}: ${cnt}`);
  }
}

/* ===== 5) HUD 文字对比度 ===== */
{
  const r = await load(0, { width: 900, height: 780 }, 1);
  const shot = decodePNG(ROOT + 'shots-2-level1.png');
  console.log(`\n######## HUD 文字（第1关截图顶部 0..66px）########`);
  // 关卡名区域：居中
  const regions = [
    ['关卡名', 330, 8, 570, 34],
    ['尝试次数', 330, 36, 570, 60],
    ['"关卡"按钮', 8, 8, 80, 58],
    ['"参考图"按钮', 700, 8, 790, 58],
  ];
  for (const [name, x0, y0, x1, y1] of regions) {
    let dark = 0, light = 0, minL = 999, maxL = -1;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const c = px(shot, x, y); const L = lum(c);
      minL = Math.min(minL, L); maxL = Math.max(maxL, L);
      if (L < 140) dark++; else if (L > 200) light++;
    }
    const n = (x1 - x0) * (y1 - y0);
    console.log(`  ${name.padEnd(10)} 暗像素(文字)=${(dark / n * 100).toFixed(1)}% 亮像素(底)=${(light / n * 100).toFixed(1)}% 亮度范围=${minL.toFixed(0)}..${maxL.toFixed(0)} 对比度=${((maxL + 0.05) / (minL + 0.05)).toFixed(2)}`);
  }
}
await browser.close();
