/**
 * 复检审计：对用户提供的 3 张真实截图做像素级取证 + 运行时几何审计
 * 不依赖"看图"，全部用数值判定。
 *
 * A) 拼块贴图是否正确：把截图中每块拼块的像素，逆旋转/缩放后
 *    与场景图 art-<kind>_scene.png 的对应区域逐像素比对；
 *    同时做「错位对照」检验（拿另一块的区域来比），看是否显著变差。
 * B) 拼块是否重叠：按多边形栅格化算两两交叠面积。
 * C) 是否被视口裁切：拼块多边形底边 vs 画布底边；截图底部是否存在被切断的像素。
 * D) 目标板参考图 + 虚线凹槽：统计板面区域内的场景色像素比例、虚线描边像素数。
 * E) 文字：读计算后的 font-size。
 */
import { chromium } from '/Users/zenghuanjia/.workbuddy/binaries/node/workspace/node_modules/playwright/index.mjs';
import { decodePNG, px, lum } from './png.mjs';
import { buildLevel, computeLayout, pointInPoly } from './puzzle-parts.js';
import { readFileSync } from 'fs';

const ROOT = '/Users/zenghuanjia/WorkBuddy/2026-11-11-10-31-19/';
const FILE = 'file://' + ROOT + '拼图乐园.html';

const LEVELS = [
  { id: 1, kind: 'dog', name: '小狗豆豆', cols: 2, rows: 1, cells: [[0, 1]], pal: 'meadow' },
  { id: 2, kind: 'cat', name: '小猫团子', cols: 1, rows: 2, cells: [[0], [1]], pal: 'sunny' },
  { id: 3, kind: 'rabbit', name: '小兔奶糖', cols: 2, rows: 2, cells: [[0, 1], [2, 2]], pal: 'lilac' },
  { id: 4, kind: 'penguin', name: '企鹅冰冰', cols: 2, rows: 2, cells: [[0, 1], [0, 2]], pal: 'polar' },
  { id: 5, kind: 'panda', name: '熊猫圆圆', cols: 2, rows: 2, cells: [[0, 1], [2, 3]], pal: 'bamboo' },
  { id: 6, kind: 'chick', name: '小鸡啾啾', cols: 3, rows: 2, cells: [[0, 0, 1], [2, 3, 3]], pal: 'aqua' },
];

/* ========== 工具 ========== */
const sat = ([r, g, b]) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx ? (mx - mn) / mx : 0; };

/** 旋转点 */
function rot(u, v, a) { const c = Math.cos(a), s = Math.sin(a); return [u * c - v * s, u * s + v * c]; }

/** 多边形栅格化：返回覆盖点集（用于求交叠面积） */
function rasterize(polyScreen, step = 1) {
  const pts = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of polyScreen) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const out = [];
  for (let y = minY; y <= maxY; y += step) {
    for (let x = minX; x <= maxX; x += step) {
      if (pointInPoly(x, y, polyScreen)) out.push([x, y]);
    }
  }
  return { pts: out, minX, maxX, minY, maxY };
}

function overlapArea(a, b, step = 1) {
  const A = rasterize(a, step).pts;
  let n = 0;
  for (const [x, y] of A) if (pointInPoly(x, y, b)) n++;
  return n * step * step;
}

/* ========== A) 拼块贴图 ↔ 场景图 对应性 ========== */
/**
 * 在截图中定位一块拼图的像素，并和场景图的「正确区域」比对。
 * @param piece   拼块几何（poly 单位坐标、anchor）
 * @param pos     屏幕上拼块中心（CSS px，画布坐标）
 * @param angle   旋转角
 * @param cell    格边长（CSS px）
 * @param canvas  画布在页面中的位置 & dpr
 * @param shot    截图 PNG
 */
function comparePieceToScene(piece, pos, angle, cell, canvas, shot, sceneImg, sceneCols, sceneRows) {
  const cellInScene = sceneImg.w / sceneCols;
  const SH = sceneImg.h;
  const cellInSceneY = SH / sceneRows;

  // 在拼块局部坐标系里采样：bbox = poly 的包围盒
  let lu0 = Infinity, lu1 = -Infinity, lv0 = Infinity, lv1 = -Infinity;
  for (const [u, v] of piece.poly) {
    lu0 = Math.min(lu0, u); lu1 = Math.max(lu1, u);
    lv0 = Math.min(lv0, v); lv1 = Math.max(lv1, v);
  }
  const N = 46;
  const samples = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const u = lu0 + (lu1 - lu0) * (i + 0.5) / N;
    const v = lv0 + (lv1 - lv0) * (j + 0.5) / N;
    // 场景坐标
    const sx = (piece.anchor[0] + u) * cellInScene;
    const sy = (piece.anchor[1] + v) * cellInSceneY;
    if (sx < 0 || sy < 0 || sx >= sceneImg.w || sy >= SH) continue;
    const sc = px(sceneImg, Math.floor(sx), Math.floor(sy));
    // 截图坐标：画布内局部坐标 → 旋转 → 页面坐标
    const [rx, ry] = rot(u * cell, v * cell, angle);
    const pageX = canvas.x + (pos.x + rx) * canvas.dpr;
    const pageY = canvas.y + (pos.y + ry) * canvas.dpr;
    if (pageX < 0 || pageY < 0 || pageX >= shot.w || pageY >= shot.h) continue;
    const sc2 = px(shot, Math.floor(pageX), Math.floor(pageY));
    samples.push([sc, sc2]);
  }
  if (!samples.length) return { n: 0, mad: null, match: 0 };
  let mad = 0, match = 0;
  for (const [a, b] of samples) {
    const d = (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 3;
    mad += d; if (d < 34) match++;
  }
  return { n: samples.length, mad: mad / samples.length, match: match / samples.length };
}

/** 错位对照：把该块与「场景中另一个块的位置」强行比对 */
function comparePieceToWrongScene(piece, pos, angle, cell, canvas, shot, sceneImg, sceneCols, sceneRows, wrongAnchor) {
  const cellInScene = sceneImg.w / sceneCols;
  const cellInSceneY = sceneImg.h / sceneRows;
  let lu0 = Infinity, lu1 = -Infinity, lv0 = Infinity, lv1 = -Infinity;
  for (const [u, v] of piece.poly) {
    lu0 = Math.min(lu0, u); lu1 = Math.max(lu1, u);
    lv0 = Math.min(lv0, v); lv1 = Math.max(lv1, v);
  }
  const N = 46;
  let mad = 0, n = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const u = lu0 + (lu1 - lu0) * (i + 0.5) / N;
    const v = lv0 + (lv1 - lv0) * (j + 0.5) / N;
    const sx = (wrongAnchor[0] + u) * cellInScene;
    const sy = (wrongAnchor[1] + v) * cellInSceneY;
    if (sx < 0 || sy < 0 || sx >= sceneImg.w || sy >= sceneImg.h) continue;
    const sc = px(sceneImg, Math.floor(sx), Math.floor(sy));
    const [rx, ry] = rot(u * cell, v * cell, angle);
    const pageX = canvas.x + (pos.x + rx) * canvas.dpr;
    const pageY = canvas.y + (pos.y + ry) * canvas.dpr;
    if (pageX < 0 || pageY < 0 || pageX >= shot.w || pageY >= shot.h) continue;
    const sc2 = px(shot, Math.floor(pageX), Math.floor(pageY));
    mad += (Math.abs(sc[0] - sc2[0]) + Math.abs(sc[1] - sc2[1]) + Math.abs(sc[2] - sc2[2])) / 3;
    n++;
  }
  return n ? mad / n : null;
}

/* ========== 主流程 ========== */
const browser = await chromium.launch({ channel: 'chrome' });

/** 在真实浏览器里跑关卡，取几何 + 字体 */
async function runLevel(idx, viewport, deviceScaleFactor) {
  const page = await browser.newPage({ viewport, deviceScaleFactor });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(700);
  await page.locator('#levelList .levelCard').nth(idx).click();
  await page.waitForTimeout(900);

  const info = await page.evaluate(() => {
    const cv = document.querySelector('#game');
    const r = cv.getBoundingClientRect();
    const st = document.querySelector('#stage').getBoundingClientRect();
    const font = (sel) => { const e = document.querySelector(sel); if (!e) return null; const c = getComputedStyle(e); return { size: c.fontSize, weight: c.fontWeight, color: c.color }; };
    return {
      canvasRect: { x: r.left, y: r.top, w: r.width, h: r.height },
      stageRect: { x: st.left, y: st.top, w: st.width, h: st.height },
      dpr: window.devicePixelRatio,
      debug: window.__debug(),
      cvAttr: { w: cv.width, h: cv.height },
      fonts: {
        levelName: font('#levelName'), attempt: font('#attemptCount'),
        star: font('#starCount'), hudBtn: font('.hudBtn'),
        sub: font('.sub'), lvName: font('.lvName'), h1: font('.panel h1'),
      },
      layout: (() => { const d = window.__probe(); return { name: d.name, assembled: d.assembledMatch }; })(),
    };
  });
  // 还原托盘最终位置（separatePieces 之后的真实 pos），并补上 poly/angle
  const lv = LEVELS[idx];
  const built = buildLevel(lv, lv.id);
  const pieces = built.pieces;
  const layout = computeLayout(pieces, lv.cols, lv.rows, info.canvasRect.w, info.canvasRect.h, { margin: 14, trayGap: 18, maxCell: 168, minCell: 48 });
  const slots = layout.slots;
  const geo = info.debug.map((d) => {
    const p = pieces[d.id];
    const slot = slots.find((s) => s.index === d.id);
    return { id: d.id, poly: p.poly, anchor: p.anchor, pos: { x: d.x, y: d.y }, angle: slot ? slot.angle : 0, home: d.home, placed: d.placed };
  });
  await page.close();
  return { info, geo, layout, lv, errs };
}

/* ---------- 审计 1：桌面 900x780，第 1 关 & 第 6 关 ---------- */
for (const [idx, shotFile] of [[0, 'shots-2-level1.png'], [5, 'shots-3-level6.png']]) {
  const { info, geo, layout, lv, errs } = await runLevel(idx, { width: 900, height: 780 }, 1);
  const shot = decodePNG(ROOT + shotFile);
  const scene = decodePNG(ROOT + `art-${lv.kind}_scene.png`);
  const canvas = { x: info.canvasRect.x, y: info.canvasRect.y, dpr: info.dpr };

  console.log(`\n============ ${shotFile}  【第${lv.id}关 ${lv.name}】 ============`);
  console.log(`画布 rect=${JSON.stringify(info.canvasRect)} dpr=${info.dpr} 画布像素=${info.cvAttr.w}x${info.cvAttr.h} 阶段区高=${info.stageRect.h}`);
  console.log(`拼合后与参考图吻合度=${(info.layout.assembled * 100).toFixed(1)}%  JS错误=${errs.length ? errs.join('|') : '无'}`);

  /* --- A) 贴图对应性 --- */
  console.log('\n[A] 拼块贴图 ↔ 场景对应性（截图实测像素）');
  for (const g of geo) {
    const right = comparePieceToScene(g, g.pos, g.angle, layout.cell, canvas, shot, scene, lv.cols, lv.rows);
    const others = geo.filter((o) => o.id !== g.id);
    let bestWrong = null;
    for (const o of others) {
      const w = comparePieceToWrongScene(g, g.pos, g.angle, layout.cell, canvas, shot, scene, lv.cols, lv.rows, o.anchor);
      if (w !== null && (bestWrong === null || w < bestWrong)) bestWrong = w;
    }
    console.log(`  块${g.id}: 正确区域 平均色差=${right.mad?.toFixed(1)} 逐像素命中率=${(right.match * 100).toFixed(0)}% 采样=${right.n}` +
      (bestWrong !== null ? `  | 错位对照(最近邻其它块)色差=${bestWrong.toFixed(1)}` : '') +
      `  → ${right.match > 0.62 ? '✅ 与参考图对应正确' : '❌ 对不上'}`);
  }

  /* --- B) 托盘重叠 --- */
  console.log('\n[B] 托盘拼块重叠（多边形栅格化交叠面积）');
  const polys = geo.map((g) => {
    const out = [];
    for (const [u, v] of g.poly) { const [rx, ry] = rot(u * layout.cell, v * layout.cell, g.angle); out.push([g.pos.x + rx, g.pos.y + ry]); }
    return out;
  });
  let maxOv = 0;
  for (let i = 0; i < polys.length; i++) for (let j = i + 1; j < polys.length; j++) {
    const a = overlapArea(polys[i], polys[j], 2);
    maxOv = Math.max(maxOv, a);
    console.log(`  块${geo[i].id}∩块${geo[j].id} = ${a} px² ${a === 0 ? '✅ 无重叠' : '⚠️ 有重叠'}`);
  }
  const pieceArea = polys.map((p) => rasterize(p, 2).pts.length * 4);
  console.log(`  最大交叠=${maxOv} px²（单块面积≈${pieceArea[0]} px²，比例 ${(maxOv / pieceArea[0] * 100).toFixed(1)}%）`);

  /* --- C) 裁切 --- */
  console.log('\n[C] 是否被画布/视口裁切');
  const canvasBottom = info.canvasRect.y + info.canvasRect.h;
  for (const p of polys) {
    const bottom = Math.max(...p.map((q) => q[1]));
    const right = Math.max(...p.map((q) => q[0]));
    const pageBottom = canvas.y + bottom;
    console.log(`  块${geo[polys.indexOf(p)].id}: 拼块底边画布内 y=${bottom.toFixed(0)}/${info.canvasRect.h.toFixed(0)} 页面底=${pageBottom.toFixed(0)}/${canvasBottom.toFixed(0)} → ${bottom <= info.canvasRect.h - 1 && pageBottom <= canvasBottom + 0.5 ? '✅ 完整显示' : '❌ 被裁切'}`);
  }
  // 截图最底部像素行：画布区域内容是否贴到最底（被切断的迹象）
  const yBot = shot.h - 1;
  let contentBottom = 0;
  for (let y = shot.h - 1; y >= 0; y--) {
    let cnt = 0;
    for (let x = 0; x < shot.w; x++) { const c = px(shot, x, y); if (sat(c) > 0.12 || lum(c) < 220) cnt++; }
    if (cnt > shot.w * 0.02) { contentBottom = y; break; }
  }
  console.log(`  截图中最后一行「有内容」的像素行=${contentBottom}/${shot.h - 1}（画布底=${canvasBottom}）→ ${contentBottom < shot.h - 3 ? '✅ 底部无被切断图形' : '⚠️ 内容贴到截图最底，可能被裁切'}`);

  /* --- D) 目标板：参考图 + 虚线凹槽 --- */
  console.log('\n[D] 目标板参考图与虚线凹槽');
  const bx = canvas.x + layout.boardX, by = canvas.y + layout.boardY, bw = layout.boardW, bh = layout.boardH;
  let inSc = 0, inBoard = 0, dash = 0, satSum = 0;
  for (let y = Math.floor(by); y < by + bh; y += 2) for (let x = Math.floor(bx); x < bx + bw; x += 2) {
    const c = px(shot, x, y); inBoard++;
    const s = sat(c); satSum += s;
    if (s > 0.05) inSc++;
    // 虚线描边：深棕 rgba(130,98,68,0.72) 混白底 → 约 (166,142,119) 左右
    if (Math.abs(c[0] - 166) < 34 && Math.abs(c[1] - 142) < 34 && Math.abs(c[2] - 119) < 34 && c[0] > 110 && c[0] < 215) dash++;
  }
  console.log(`  板面 ${bw.toFixed(0)}x${bh.toFixed(0)}：含场景色像素=${(inSc / inBoard * 100).toFixed(1)}% 平均饱和=${(satSum / inBoard).toFixed(3)} → 参考图${inSc / inBoard > 0.2 ? '✅ 可见' : '❌ 几乎不可见'}`);
  console.log(`  虚线凹槽描边像素≈${dash} 个采样命中 → ${dash > 30 ? '✅ 凹槽轮廓可见' : '❌ 凹槽看不清'}`);

  /* --- E) 字体 --- */
  console.log('\n[E] 文字');
  for (const [k, v] of Object.entries(info.fonts)) {
    if (v) console.log(`  ${k.padEnd(10)} ${v.size} / ${v.weight} / ${v.color}`);
  }
}

/* ---------- 审计 2：手机竖屏 390x844 ---------- */
{
  const { info, geo, layout, lv, errs } = await runLevel(0, { width: 390, height: 844 }, 2);
  const shot = decodePNG(ROOT + 'shots-5-mobile.png');
  console.log(`\n============ shots-5-mobile.png 【手机 390x844 @2x】 ============`);
  console.log(`画布 rect=${JSON.stringify(info.canvasRect)} dpr=${info.dpr} 画布像素=${info.cvAttr.w}x${info.cvAttr.h} 阶段区高=${info.stageRect.h} JS错误=${errs.length ? errs.join('|') : '无'}`);
  console.log(`截图尺寸=${shot.w}x${shot.h}`);
  const canvasBottom = info.canvasRect.y + info.canvasRect.h;
  console.log(`画布底(页面)=${canvasBottom} 视口高=844 → ${canvasBottom <= 844.5 ? '✅ 画布未溢出视口' : `❌ 溢出 ${(canvasBottom - 844).toFixed(0)}px`}`);
  const polys = geo.map((g) => {
    const out = [];
    for (const [u, v] of g.poly) { const [rx, ry] = rot(u * layout.cell, v * layout.cell, g.angle); out.push([g.pos.x + rx, g.pos.y + ry]); }
    return out;
  });
  for (let i = 0; i < polys.length; i++) {
    const bottom = Math.max(...polys[i].map((q) => q[1]));
    const pageBottom = info.canvasRect.y + bottom;
    console.log(`  块${geo[i].id}: 底边 页面 y=${pageBottom.toFixed(0)} / 画布底=${canvasBottom.toFixed(0)} → ${pageBottom <= canvasBottom + 0.5 ? '✅ 完整显示' : '❌ 被裁切'}`);
  }
  // 移动端字号
  for (const [k, v] of Object.entries(info.fonts)) if (v) console.log(`  ${k.padEnd(10)} ${v.size} / ${v.weight} / ${v.color}`);
}

await browser.close();
