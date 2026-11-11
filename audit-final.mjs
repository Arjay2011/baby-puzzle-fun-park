/**
 * 终检：
 *  1) HUD 文字：取真实元素包围盒，量文字像素对比度 + 字号
 *  2) 拼块白色描边环：径向扫描，找是否存在"近白描边带"
 *  3) 虚线凹槽：沿板面找暗色虚线像素带，量与紧邻背景对比度
 *  4) 手机右边缘：确认被切的是拼块还是板面
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
    const box = (sel) => { const e = document.querySelector(sel); if (!e) return null; const q = e.getBoundingClientRect(); const c = getComputedStyle(e); return { x: q.left, y: q.top, w: q.width, h: q.height, size: c.fontSize, weight: c.fontWeight, color: c.color, text: e.textContent.trim() }; };
    return {
      canvas: { x: b.left, y: b.top, w: b.width, h: b.height }, dpr: window.devicePixelRatio, dbg: window.__debug(),
      hud: { levelName: box('#levelName'), attempt: box('#attemptCount'), star: box('#starCount'), menuBtn: box('#menuBtn'), refBtn: box('#refBtn'), soundBtn: box('#soundBtn') },
    };
  });
  await page.close();
  return r;
}

/* ===== 1) HUD 文字真实测量（桌面第1关截图） ===== */
{
  const r = await load(0, { width: 900, height: 780 }, 1);
  const shot = decodePNG(ROOT + 'shots-2-level1.png');
  console.log('======== HUD 文字实测（shots-2-level1.png 顶部）========');
  for (const [name, b] of Object.entries(r.hud)) {
    if (!b) continue;
    const x0 = Math.max(0, Math.floor(b.x)), y0 = Math.max(0, Math.floor(b.y));
    const x1 = Math.min(shot.w, Math.ceil(b.x + b.w)), y1 = Math.min(shot.h, Math.ceil(b.y + b.h));
    let darkest = [255, 255, 255], lightest = [0, 0, 0], darkN = 0, tot = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const c = px(shot, x, y); tot++;
      if (lum(c) < lum(darkest)) darkest = c;
      if (lum(c) > lum(lightest)) lightest = c;
      if (lum(c) < 150) darkN++;
    }
    console.log(`  ${name.padEnd(10)} "${b.text}" ${b.size}/${b.weight} ${b.color}  最暗=(${darkest.join(',')}) 最亮=(${lightest.join(',')}) 对比度=${cr(darkest, lightest).toFixed(2)} 文字像素占比=${(darkN / tot * 100).toFixed(1)}%`);
  }
}

/* ===== 2) 拼块描边环 + 3) 虚线凹槽（桌面第1关） ===== */
{
  const r = await load(0, { width: 900, height: 780 }, 1);
  const shot = decodePNG(ROOT + 'shots-2-level1.png');
  const lv = { id: 1, kind: 'dog', cols: 2, rows: 1, cells: [[0, 1]] };
  const built = buildLevel(lv, lv.id);
  const layout = computeLayout(built.pieces, lv.cols, lv.rows, r.canvas.w, r.canvas.h, { margin: 14, trayGap: 18, maxCell: 168, minCell: 48 });
  const slots = layout.slots;
  console.log('\n======== 拼块描边环（径向扫描）========');
  for (const d of r.dbg) {
    const p = built.pieces[d.id];
    const slot = slots.find((s) => s.index === d.id);
    const a = slot ? slot.angle : 0;
    // 找轮廓上一点，沿法线向外扫描 0..8px，看亮度是否先升（白描边）再降
    let ringMax = -1, ringMin = 255, inside = null;
    for (let i = 0; i < p.poly.length; i++) {
      const [u1, v1] = p.poly[i], [u2, v2] = p.poly[(i + 1) % p.poly.length];
      const ex = u2 - u1, ey = v2 - v1; const L = Math.hypot(ex, ey) || 1;
      const nx = ey / L, ny = -ex / L;
      const mu = (u1 + u2) / 2, mv = (v1 + v2) / 2;
      for (const sgn of [1, -1]) {
        const seq = [];
        for (let t = 0; t <= 10; t++) {
          const du = mu + nx * sgn * t * 0.03, dv = mv + ny * sgn * t * 0.03;
          const [rx, ry] = rot(du * layout.cell, dv * layout.cell, a);
          const X = Math.round(r.x + (d.x + rx) * r.dpr), Y = Math.round(r.y + (d.y + ry) * r.dpr);
          if (X < 0 || Y < 0 || X >= shot.w || Y >= shot.h) { seq.push(null); continue; }
          seq.push(px(shot, X, Y));
        }
        // 找最亮的近白带
        for (const c of seq) if (c) { const L2 = lum(c); ringMax = Math.max(ringMax, L2); ringMin = Math.min(ringMin, L2); }
        if (inside === null) {
          const c0 = seq[0]; if (c0) inside = c0;
        }
      }
    }
    console.log(`  块${d.id}: 描边环最亮像素亮度=${ringMax.toFixed(0)}（255=纯白描边）最暗=${ringMin.toFixed(0)} → ${ringMax > 235 ? '✅ 存在清晰白色描边环' : '⚠️ 未找到明显白色描边'}`);
  }

  console.log('\n======== 目标板虚线凹槽（沿凹槽线逐点找最暗像素 + 邻近背景）========');
  const bx = r.canvas.x + layout.boardX, by = r.canvas.y + layout.boardY;
  for (const p of built.pieces) {
    const hx = layout.boardX + p.anchor[0] * layout.cell, hy = layout.boardY + p.anchor[1] * layout.cell;
    let dashDark = null, dashN = 0, bgSum = 0, bgN = 0;
    for (let i = 0; i < p.poly.length; i++) {
      const [u1, v1] = p.poly[i], [u2, v2] = p.poly[(i + 1) % p.poly.length];
      const mu = (u1 + u2) / 2, mv = (v1 + v2) / 2;
      for (let t = 0; t <= 10; t++) {
        const du = u1 + (u2 - u1) * t / 10, dv = v1 + (v2 - v1) * t / 10;
        const X = Math.round(bx + (hx + du) * 0 + layout.boardX * 0 + (hx + du - hx) * 0 + (r.canvas.x + layout.boardX + du * layout.cell) * 0 + (r.canvas.x + layout.boardX + du * layout.cell));
        // 简化：目标板坐标 = boardX + anchor*cell + poly*cell（画布坐标）→ 页面坐标
        const PX = Math.round(r.canvas.x + layout.boardX + (p.anchor[0] + du) * layout.cell);
        const PY = Math.round(r.canvas.y + layout.boardY + (p.anchor[1] + dv) * layout.cell);
        if (PX < 0 || PY < 0 || PX >= shot.w || PY >= shot.h) continue;
        const c = px(shot, PX, PY);
        if (!dashDark || lum(c) < lum(dashDark)) dashDark = c;
        dashN++;
        // 背景：偏移 6px
        const bx2 = px(shot, Math.min(shot.w - 1, PX + 7), PY);
        bgSum += lum(bx2); bgN++;
      }
    }
    const bgL = bgSum / bgN;
    console.log(`  凹槽最暗像素 RGB=(${dashDark.join(',')}) 亮度=${lum(dashDark).toFixed(0)}  邻近背景亮度=${bgL.toFixed(0)}  对比度=${cr(dashDark, [bgL, bgL, bgL]).toFixed(2)} → ${cr(dashDark, [bgL, bgL, bgL]) >= 3 ? '✅ 清楚' : '⚠️ 偏淡'}`);
  }
}

/* ===== 4) 手机右边缘：切的是拼块还是板面 ===== */
{
  const r = await load(0, { width: 390, height: 844 }, 2);
  const shot = decodePNG(ROOT + 'shots-5-mobile.png');
  console.log('\n======== 手机截图右边缘分析 =====');
  console.log(`  画布 CSS 右边界 = ${r.canvas.x + r.canvas.w} (视口宽 390) → 画布右缘 = 截图右缘 x=780(device)`);
  // 板面右边界
  const lv = { id: 1, kind: 'dog', cols: 2, rows: 1, cells: [[0, 1]] };
  const layout = computeLayout(buildLevel(lv, lv.id).pieces, 2, 1, r.canvas.w, r.canvas.h, { margin: 14, trayGap: 18, maxCell: 168, minCell: 48 });
  console.log(`  板面 CSS: x=${layout.boardX.toFixed(0)} w=${layout.boardW.toFixed(0)} → 右缘 CSS x=${(layout.boardX + layout.boardW).toFixed(0)} device=${((layout.boardX + layout.boardW) * r.dpr).toFixed(0)}`);
  // 拼块1 右缘
  const built = buildLevel(lv, lv.id);
  const slots = layout.slots;
  for (const d of r.dbg) {
    const p = built.pieces[d.id];
    const slot = slots.find((s) => s.index === d.id);
    const a = slot ? slot.angle : 0;
    let rt = -Infinity;
    for (const [u, v] of p.poly) { const [x, y] = rot(u * layout.cell, v * layout.cell, a); rt = Math.max(rt, d.x + x); }
    console.log(`  块${d.id} 右缘 CSS x=${rt.toFixed(0)} → device ${(rt * r.dpr).toFixed(0)}  ${rt > r.canvas.w ? `❌ 超出画布 ${(rt - r.canvas.w).toFixed(0)} CSS px = ${((rt - r.canvas.w) * r.dpr).toFixed(0)} device px` : '✅ 在画布内'}`);
  }
  // 右边缘 30px 内：白色描边有无
  let white = 0, satc = 0;
  for (let x = shot.w - 30; x < shot.w; x++) for (let y = 168; y < shot.h; y++) {
    const c = px(shot, x, y); const mx = Math.max(...c), mn = Math.min(...c); const s = mx ? (mx - mn) / mx : 0;
    if (c[0] > 244 && c[1] > 244 && c[2] > 244) white++;
    if (s > 0.15) satc++;
  }
  console.log(`  右侧 30px 区域: 近白像素=${white}  彩色像素=${satc} → ${white > 300 ? '有描边(可能已画到边缘)' : '几乎无白色描边 → 图形被右边缘硬切'}`);
  // 逐列看右边缘是否有白色竖线（描边）
  for (let x = shot.w - 6; x < shot.w; x++) {
    let w = 0, s2 = 0, rows = [];
    for (let y = 168; y < shot.h; y++) { const c = px(shot, x, y); if (c[0] > 244 && c[1] > 244 && c[2] > 244) w++; const mx = Math.max(...c), mn = Math.min(...c); if (mx ? (mx - mn) / mx : 0 > 0.15) s2++; }
    console.log(`    x=${x}: 近白=${w} 彩色=${s2}`);
  }
}
await browser.close();
