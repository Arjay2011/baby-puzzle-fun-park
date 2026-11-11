/**
 * 阶段 C（像素取证）：直接分析 5 张真实截图的渲染结果
 */
import { decodePNG, px, hex, lum } from './png.mjs';
import { LEVELS, buildLevel, computeLayout } from './puzzle-parts.js';

const ROOT = '/Users/zenghuanjia/WorkBuddy/2026-11-11-10-31-19/';

function inPoly(x, y, pts) {
  let ins = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
function edgeDist(x, y, pts) {
  let m = 1e9;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, ay] = pts[j], [bx, by] = pts[i];
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    m = Math.min(m, Math.hypot(x - (ax + dx * t), y - (ay + dy * t)));
  }
  return m;
}

/** 统计一块区域内的像素特征 */
function regionStats(img, poly, dpr) {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(img.w - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(img.h - 1, Math.ceil(Math.max(...ys)));
  let n = 0, satSum = 0, dark = 0, white = 0, lumSum = 0, lumSq = 0;
  const uniq = new Set();
  let ringW = 0, ringN = 0;
  const hist = {};
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const [r, g, b] = px(img, x, y);
      if (!inPoly(x, y, poly)) continue;
      const Lm = 0.299 * r + 0.587 * g + 0.114 * b;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const s = mx ? (mx - mn) / mx : 0;
      n++; satSum += s; lumSum += Lm; lumSq += Lm * Lm;
      if (Lm < 80) dark++;
      if (Lm > 242) white++;
      uniq.add((r >> 4) + ',' + (g >> 4) + ',' + (b >> 4));
      const key = ((r / 64) | 0) + ',' + ((g / 64) | 0) + ',' + ((b / 64) | 0);
      hist[key] = (hist[key] || 0) + 1;
      const ed = edgeDist(x, y, poly);
      if (ed * dpr > 1.5 && ed * dpr < 7) { ringN++; if (Lm > 238) ringW++; }
    }
  }
  const mean = n ? Math.sqrt(Math.max(0, lumSq / n - (lumSum / n) ** 2)) : 0;
  const top = Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([k, v]) => { const [r, g, b] = k.split(',').map((v) => v * 64 + 32); return { c: hex([r, g, b]), pct: +(v / (n || 1) * 100).toFixed(1) }; });
  return {
    px: n, uniqueColors: uniq.size, avgSat: +(satSum / (n || 1)).toFixed(3),
    lumStd: +mean.toFixed(1), darkPct: +(dark / (n || 1) * 100).toFixed(2),
    whitePct: +(white / (n || 1) * 100).toFixed(1),
    strokeWhitePct: +(ringW / (ringN || 1) * 100).toFixed(1),
    topColors: top,
  };
}

/** 沿多边形采样虚线描边（rgba(150,120,90,.42) 在浅底上 → 约 (200,190,175)） */
function dashCheck(img, poly, dpr) {
  let dash = 0, total = 0, sample = [];
  for (let i = 0; i < poly.length - 1; i++) {
    const [ax, ay] = poly[i], [bx, by] = poly[i + 1];
    const len = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(2, Math.round(len * dpr / 2));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = Math.round((ax + (bx - ax) * t) * dpr), y = Math.round((ay + (by - ay) * t) * dpr);
      if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue;
      const [r, g, b] = px(img, x, y);
      total++;
      const isDash = r > 165 && r < 235 && g > 150 && g < 225 && b > 130 && b < 210 && (r - b) > 12 && (r - b) < 60;
      if (isDash) { dash++; if (sample.length < 6) sample.push(hex([r, g, b])); }
    }
  }
  return { total, dashHits: dash, ratio: +(dash / (total || 1) * 100).toFixed(1), samples: sample };
}

/** 整图分块分析：找出大片空白 / 异常 */
function blankMap(img, cols, rows) {
  const bw = Math.floor(img.w / cols), bh = Math.floor(img.h / rows);
  const cells = [];
  for (let gy = 0; gy < rows; gy++) {
    let line = '';
    for (let gx = 0; gx < cols; gx++) {
      let n = 0, sat = 0, uniq = new Set();
      for (let y = gy * bh; y < (gy + 1) * bh; y += 2) for (let x = gx * bw; x < (gx + 1) * bw; x += 2) {
        const [r, g, b] = px(img, x, y); const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        sat += mx ? (mx - mn) / mx : 0; n++;
        uniq.add((r >> 4) + ',' + (g >> 4) + ',' + (b >> 4));
      }
      const s = sat / n;
      line += s < 0.06 && uniq.size < 6 ? '.' : (uniq.size < 10 ? ':' : (uniq.size < 26 ? 'o' : '#'));
      cells.push({ gx, gy, sat: +s.toFixed(3), uniq: uniq.size });
    }
    console.log('  ' + line);
  }
  return cells;
}

/* ============ 1. 菜单 ============ */
console.log('\n########## shots-1-menu.png (900x780) ##########');
{
  const img = decodePNG(ROOT + 'shots-1-menu.png');
  console.log(`尺寸 ${img.w}x${img.h}`);
  console.log('分块饱和度地图 (18x16, "."=近空白):');
  blankMap(img, 18, 16);
  // 底部/顶部留白
  const topRow = px(img, 450, 6), bottomRow = px(img, 450, img.h - 6);
  console.log('顶部像素', hex(topRow), '底部像素', hex(bottomRow));
}

/* ============ 2 & 3. 游玩中 ============ */
function playShot(file, levelIdx, label, canvasPageY, dpr) {
  console.log(`\n########## ${file} — ${label} ##########`);
  const img = decodePNG(ROOT + file);
  console.log(`尺寸 ${img.w}x${img.h} dpr=${dpr}`);
  const lv = LEVELS[levelIdx];
  const built = buildLevel(lv, lv.id);
  const layout = computeLayout(built.pieces, lv.cols, lv.rows, dpr === 1 ? 900 : 390, dpr === 1 ? 780 : 844,
    { margin: 14, trayGap: 18, maxCell: 168, minCell: 48 });
  console.log(`布局 cell=${layout.cell.toFixed(1)} board=(${layout.boardX.toFixed(0)},${layout.boardY.toFixed(0)} ${layout.boardW.toFixed(0)}x${layout.boardH.toFixed(0)}) trayTop=${layout.trayTop.toFixed(0)}`);

  // 画布可见区域：截图 y 从 canvasPageY*dpr 开始
  const visTop = canvasPageY * dpr;
  console.log(`画布顶(页面)=${canvasPageY}px → 截图 y=${visTop}；画布高 ${(dpr === 1 ? 780 : 844) * dpr}px，截图可见底=${img.h} → 画布底部被裁 ${(dpr === 1 ? 780 : 844) * dpr - (img.h - visTop)}px`);

  built.pieces.forEach((p, idx) => {
    const slot = layout.slots.find((s) => s.index === idx);
    const cx = slot.x + slot.jitterX, cy = slot.y + slot.jitterY;
    const poly = p.poly.map((pt) => [cx + pt[0] * layout.cell, cy + pt[1] * layout.cell]);
    const screenPoly = poly.map((q) => [q[0] * dpr, q[1] * dpr + visTop]);
    const st = regionStats(img, screenPoly, dpr);
    const ys = screenPoly.map((q) => q[1]);
    const clipped = Math.max(...ys) > img.h;
    console.log(`  拼块 id${p.id} (${p.wCells}x${p.hCells}) 托盘中心=(${cx.toFixed(0)},${cy.toFixed(0)}) angle=${(slot.angle * 180 / Math.PI).toFixed(1)}° 截图内bbox y=[${Math.min(...ys).toFixed(0)},${Math.max(...ys).toFixed(0)}] ${clipped ? '⛔底部被裁切' : ''}`);
    console.log(`     像素: ${JSON.stringify(st)}`);
    // 归位槽虚线
    const home = { x: layout.boardX + p.anchor[0] * layout.cell, y: layout.boardY + p.anchor[1] * layout.cell };
    const homePoly = p.poly.map((pt) => [home.x + pt[0] * layout.cell, home.y + pt[1] * layout.cell])
      .map((q) => [q[0] * dpr, q[1] * dpr + visTop]);
    const dc = dashCheck(img, homePoly, dpr);
    console.log(`     目标虚线: 命中 ${dc.dashHits}/${dc.total} (${dc.ratio}%) 样本=${dc.samples.join(',')}`);
  });
  console.log('  分块地图:');
  blankMap(img, 15, 13);
}

playShot('shots-2-level1.png', 0, '第1关 小狗豆豆 (2片)', 66, 1);
playShot('shots-3-level6.png', 5, '第6关 小鸡啾啾 (4片/L形)', 66, 1);

/* ============ 4. 通关结算 ============ */
console.log('\n########## shots-4-complete.png ##########');
{
  const img = decodePNG(ROOT + 'shots-4-complete.png');
  console.log(`尺寸 ${img.w}x${img.h}`);
  console.log('分块地图:');
  blankMap(img, 18, 16);
  // 星星区域 y=383.5..435.5 (页面) → 截图同坐标
  const starYs = 384, starXs = [362, 424, 486];
  for (const sx of starXs) {
    const [r, g, b] = px(img, sx + 26, starYs + 26);
    console.log(`  星星中心 (${sx + 26},${starYs + 26}) = ${hex([r, g, b])}  lum=${lum([r, g, b]).toFixed(0)}`);
  }
  // 面板底色
  console.log('  面板左上角(40,300)=', hex(px(img, 40, 300)), ' 面板中心(450,120)=', hex(px(img, 450, 120)));
  // 星星区对比
  const gold = [255, 210, 74], panelBg = [255, 248, 236];
  console.log('  金星 vs 面板底 对比度 =', ((Math.max(lum(gold), lum(panelBg)) + 0.05) / (Math.min(lum(gold), lum(panelBg)) + 0.05)).toFixed(2));
  // 按钮文字对比：白字 vs 橙渐变底 #FF8C42
  const orange = [255, 140, 66];
  console.log('  按钮白字 vs 橙底 对比度 =', ((Math.max(lum([255, 255, 255]), lum(orange)) + 0.05) / (Math.min(lum([255, 255, 255]), lum(orange)) + 0.05)).toFixed(2));
}

/* ============ 5. 手机竖屏 ============ */
{
  console.log('\n########## shots-5-mobile.png (390x844 @2x = 780x1688) ##########');
  const img = decodePNG(ROOT + 'shots-5-mobile.png');
  console.log(`尺寸 ${img.w}x${img.h}`);
  console.log('分块地图:');
  blankMap(img, 12, 26);
  const lv = LEVELS[0];
  const built = buildLevel(lv, lv.id);
  const layout = computeLayout(built.pieces, lv.cols, lv.rows, 390, 844, { margin: 14, trayGap: 18, maxCell: 168, minCell: 48 });
  const visTop = 84 * 2;
  built.pieces.forEach((p, idx) => {
    const slot = layout.slots.find((s) => s.index === idx);
    const cx = slot.x + slot.jitterX, cy = slot.y + slot.jitterY;
    const poly = p.poly.map((pt) => [cx + pt[0] * layout.cell, cy + pt[1] * layout.cell])
      .map((q) => [q[0] * 2, q[1] * 2 + visTop]);
    const st = regionStats(img, poly, 2);
    const ys = poly.map((q) => q[1]);
    console.log(`  拼块 id${p.id} 截图bbox y=[${Math.min(...ys).toFixed(0)},${Math.max(...ys).toFixed(0)}] ${Math.max(...ys) > img.h ? '⛔底部被裁切' : '✅完整'} ${JSON.stringify(st)}`);
  });
  // 目标板区域
  const boardPoly = [[layout.boardX * 2, layout.boardY * 2 + visTop], [(layout.boardX + layout.boardW) * 2, layout.boardY * 2 + visTop],
    [(layout.boardX + layout.boardW) * 2, (layout.boardY + layout.boardH) * 2 + visTop], [layout.boardX * 2, (layout.boardY + layout.boardH) * 2 + visTop]];
  console.log('  目标板区域统计:', JSON.stringify(regionStats(img, boardPoly, 2)));
  // 底边是否空白（视口底部 20px）
  let bottomSat = 0, bn = 0;
  for (let y = img.h - 20; y < img.h; y++) for (let x = 0; x < img.w; x += 2) {
    const [r, g, b] = px(img, x, y); const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    bottomSat += mx ? (mx - mn) / mx : 0; bn++;
  }
  console.log(`  视口底部 20px 平均饱和度 = ${(bottomSat / bn).toFixed(3)}（0=纯空白）`);
}
