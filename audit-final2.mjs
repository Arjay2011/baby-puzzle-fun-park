/**
 * 修正版终检
 *  A) 拼块描边：直接在截图里找「近白描边环」——沿轮廓向外 0..10px 扫描亮度剖面
 *  B) 手机右缘：逐点采样颜色，确认是背景还是被切的拼块
 *  C) 手机版 HUD / 板面 / 参考图
 */
import { decodePNG, px, lum } from './png.mjs';
import { chromium } from '/Users/zenghuanjia/.workbuddy/binaries/node/workspace/node_modules/playwright/index.mjs';
import { buildLevel, computeLayout } from './puzzle-parts.js';

const ROOT = '/Users/zenghuanjia/WorkBuddy/2026-11-11-10-31-19/';
const FILE = 'file://' + ROOT + '拼图乐园.html';
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
    return { canvas: { x: b.left, y: b.top, w: b.width, h: b.height }, dpr: window.devicePixelRatio, dbg: window.__debug() };
  });
  await page.close();
  return r;
}

/* ===== A) 描边亮度剖面 ===== */
console.log('======== 拼块描边：沿轮廓法线的亮度剖面（找白色描边带）========');
{
  const r = await load(0, { width: 900, height: 780 }, 1);
  const shot = decodePNG(ROOT + 'shots-2-level1.png');
  const lv = { id: 1, kind: 'dog', cols: 2, rows: 1, cells: [[0, 1]] };
  const built = buildLevel(lv, lv.id);
  const layout = computeLayout(built.pieces, lv.cols, lv.rows, r.canvas.w, r.canvas.h, { margin: 14, trayGap: 18, maxCell: 168, minCell: 48 });
  const slots = layout.slots;
  for (const d of r.dbg) {
    const p = built.pieces[d.id];
    const slot = slots.find((s) => s.index === d.id);
    const a = slot ? slot.angle : 0;
    const profs = [];
    for (let i = 0; i < p.poly.length; i += 3) {
      const [u1, v1] = p.poly[i], [u2, v2] = p.poly[(i + 1) % p.poly.length];
      const ex = u2 - u1, ey = v2 - v1; const L = Math.hypot(ex, ey) || 1;
      const nx = ey / L, ny = -ex / L;
      const mu = (u1 + u2) / 2, mv = (v1 + v2) / 2;
      for (const sgn of [1, -1]) {
        const prof = [];
        for (let t = -4; t <= 10; t++) {
          const du = mu + nx * sgn * t * 0.025, dv = mv + ny * sgn * t * 0.025;
          const [rx, ry] = rot(du * layout.cell, dv * layout.cell, a);
          const X = Math.round(r.canvas.x + (d.x + rx) * r.dpr);
          const Y = Math.round(r.canvas.y + (d.y + ry) * r.dpr);
          prof.push((X < 0 || Y < 0 || X >= shot.w || Y >= shot.h) ? null : Math.round(lum(px(shot, X, Y))));
        }
        if (prof.some(v => v !== null)) profs.push(prof);
      }
    }
    // 汇总：每档（偏移）的最大亮度 → 白色描边应在 t≈0 附近出现局部极大
    const maxAt = [];
    for (let t = 0; t < 15; t++) {
      let mx = -1;
      for (const pr of profs) { const v = pr[t]; if (v !== null && v !== undefined && v > mx) mx = v; }
      maxAt.push(mx);
    }
    const peak = Math.max(...maxAt);
    console.log(`  块${d.id} 亮度剖面(t=-4..10): ${maxAt.map(v => v < 0 ? ' --' : String(v).padStart(3)).join(' ')}`);
    console.log(`       峰值=${peak} ${peak >= 240 ? '✅ 有明显白色描边' : peak >= 215 ? '⚠️ 描边偏灰' : '❌ 无描边'}`);
  }
}

/* ===== B) 手机右缘逐点采样 ===== */
console.log('\n======== shots-5-mobile.png 右缘采样 =====');
{
  const shot = decodePNG(ROOT + 'shots-5-mobile.png');
  const r = await load(0, { width: 390, height: 844 }, 2);
  console.log(`  画布 device: x 0..${r.canvas.w * r.dpr}, y ${r.canvas.y * r.dpr}..${(r.canvas.y + r.canvas.h) * r.dpr}`);
  for (const y of [200, 400, 600, 800, 1000, 1200, 1400, 1600]) {
    const cols = [];
    for (const x of [700, 720, 726, 740, 760, 770, 779]) {
      const c = px(shot, x, y);
      cols.push(`x${x}=(${c.join(',')})`);
    }
    console.log(`  y=${y}: ${cols.join(' ')}`);
  }
  // 右缘最后一列与倒数第 30 列比较：若完全相同 → 是背景铺满；若不同 → 有图形
  let same = 0, diff = 0;
  for (let y = 168; y < shot.h; y++) {
    const a = px(shot, 779, y), b = px(shot, 700, y);
    const d = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
    if (d < 12) same++; else diff++;
  }
  console.log(`  右缘列 vs x=700 列：相同行=${same} 不同行=${diff} → ${diff > 400 ? '⚠️ 右缘是独立的图形内容（拼块被切）' : '✅ 右缘是背景'}`);
  // 找出右缘内容的纵向范围
  let y0 = -1, y1 = -1;
  for (let y = 168; y < shot.h; y++) {
    const a = px(shot, 779, y), b = px(shot, 700, y);
    const d = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
    if (d >= 12) { if (y0 < 0) y0 = y; y1 = y; }
  }
  console.log(`  右缘图形纵向范围 device y=${y0}..${y1}（CSS ${(y0 / 2).toFixed(0)}..${(y1 / 2).toFixed(0)}），高 ${((y1 - y0) / 2).toFixed(0)} CSS px`);
  // 该范围外右缘是否有白色描边（拼块右边缘的白色描边被切 → 无描边）
  let wh = 0;
  for (let y = y0; y <= y1; y++) { const c = px(shot, 779, y); if (c[0] > 244 && c[1] > 244 && c[2] > 244) wh++; }
  console.log(`  该范围内右缘近白描边像素=${wh}/${y1 - y0 + 1} → ${wh < 20 ? '❌ 无描边 = 拼块被右边缘硬切' : '✅ 有描边'}`);
}

/* ===== C) 手机板面参考图 + 凹槽 ===== */
console.log('\n======== 手机版目标板 =====');
{
  const r = await load(0, { width: 390, height: 844 }, 2);
  const shot = decodePNG(ROOT + 'shots-5-mobile.png');
  const lv = { id: 1, kind: 'dog', cols: 2, rows: 1, cells: [[0, 1]] };
  const layout = computeLayout(buildLevel(lv, lv.id).pieces, 2, 1, r.canvas.w, r.canvas.h, { margin: 14, trayGap: 18, maxCell: 168, minCell: 48 });
  const bx = r.canvas.x + layout.boardX, by = r.canvas.y + layout.boardY;
  let colored = 0, tot = 0, dash = 0;
  for (let y = Math.floor(by * r.dpr); y < (by + layout.boardH) * r.dpr; y += 3) for (let x = Math.floor(bx * r.dpr); x < (bx + layout.boardW) * r.dpr; x += 3) {
    const c = px(shot, x, y); tot++;
    const mx = Math.max(...c), mn = Math.min(...c); const s = mx ? (mx - mn) / mx : 0;
    if (s > 0.05) colored++;
    if (Math.abs(c[0] - 166) < 40 && Math.abs(c[1] - 142) < 40 && Math.abs(c[2] - 119) < 40 && c[0] > 100) dash++;
  }
  console.log(`  板面 ${layout.boardW.toFixed(0)}x${layout.boardH.toFixed(0)} CSS；含场景色像素=${(colored / tot * 100).toFixed(1)}% → 参考图${colored / tot > 0.15 ? '✅ 可见' : '❌ 太淡'}；虚线像素≈${dash} → ${dash > 15 ? '✅ 可见' : '❌ 太淡'}`);
  console.log(`  板面位置 CSS: x=${layout.boardX.toFixed(0)} y=${layout.boardY.toFixed(0)} w=${layout.boardW.toFixed(0)} h=${layout.boardH.toFixed(0)}  托盘顶=${layout.trayTop.toFixed(0)} 画布高=${r.canvas.h}`);
}
await browser.close();
