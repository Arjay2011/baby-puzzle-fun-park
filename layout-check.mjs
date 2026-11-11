/**
 * 阶段 B（纯逻辑）：复算真实布局几何
 */
import { LEVELS, buildLevel, computeLayout } from './puzzle-parts.js';

const cases = [
  { tag: 'desktop', W: 900, H: 780, dpr: 1, canvasPageY: 66, vpH: 780, vpW: 900 },
  { tag: 'mobile', W: 390, H: 844, dpr: 2, canvasPageY: 84, vpH: 844, vpW: 390 },
];

const out = {};
for (const c of cases) {
  const res = [];
  for (let i = 0; i < LEVELS.length; i++) {
    const lv = LEVELS[i];
    const built = buildLevel(lv, lv.id);
    const layout = computeLayout(built.pieces, lv.cols, lv.rows, c.W, c.H, {
      margin: 14, trayGap: 18, maxCell: 168, minCell: 48,
    });
    const pieces = built.pieces.map((p, idx) => {
      const slot = layout.slots.find((s) => s.index === idx);
      const px = slot.x + slot.jitterX, py = slot.y + slot.jitterY;
      const pts = p.poly.map((pt) => [px + pt[0] * layout.cell, py + pt[1] * layout.cell]);
      const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
      const home = { x: layout.boardX + p.anchor[0] * layout.cell, y: layout.boardY + p.anchor[1] * layout.cell };
      const hpts = p.poly.map((pt) => [home.x + pt[0] * layout.cell, home.y + pt[1] * layout.cell]);
      const hxs = hpts.map((q) => q[0]), hys = hpts.map((q) => q[1]);
      return {
        id: p.id, cells: p.cells, wCells: p.wCells, hCells: p.hCells,
        trayCenter: [Math.round(px), Math.round(py)], angleDeg: +(slot.angle * 180 / Math.PI).toFixed(1),
        trayBBox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(Math.round),
        homeBBox: [Math.min(...hxs), Math.min(...hys), Math.max(...hxs), Math.max(...hys)].map(Math.round),
        poly: pts, homePoly: hpts,
      };
    });
    // 托盘重叠
    const overlaps = [];
    const inPoly = (x, y, pts) => { let ins = false; for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) {
      const [xi, yi] = pts[a], [xj, yj] = pts[b];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins; } return ins; };
    for (let a = 0; a < pieces.length; a++) for (let b = a + 1; b < pieces.length; b++) {
      let hit = false;
      for (const q of pieces[a].poly) if (inPoly(q[0], q[1], pieces[b].poly)) { hit = true; break; }
      if (!hit) for (const q of pieces[b].poly) if (inPoly(q[0], q[1], pieces[a].poly)) { hit = true; break; }
      if (hit) overlaps.push([pieces[a].id, pieces[b].id]);
    }
    // 出界（画布内 & 视口内）
    const offCanvas = [], offViewport = [];
    for (const p of pieces) {
      const bb = p.trayBBox;
      if (bb[0] < 0 || bb[1] < 0 || bb[2] > c.W || bb[3] > c.H) offCanvas.push({ id: p.id, bb });
      const vpTop = c.canvasPageY, vpBottom = c.canvasPageY + c.H;
      const vb = [bb[0], bb[1] + vpTop, bb[2], bb[3] + vpTop];
      if (vb[3] > c.vpH || vb[1] < 0 || vb[2] > c.vpW) offViewport.push({ id: p.id, vb });
    }
    res.push({
      level: i + 1, name: lv.name, cols: lv.cols, rows: lv.rows, nPieces: pieces.length,
      cell: +layout.cell.toFixed(1), board: { x: Math.round(layout.boardX), y: Math.round(layout.boardY), w: Math.round(layout.boardW), h: Math.round(layout.boardH) },
      trayTop: Math.round(layout.trayTop), trayH: Math.round(layout.trayH),
      pieces: pieces.map((p) => ({ id: p.id, cells: p.cells, w: p.wCells, h: p.hCells, trayCenter: p.trayCenter, angle: p.angleDeg, trayBBox: p.trayBBox, homeBBox: p.homeBBox })),
      overlaps, offCanvas, offViewport,
      boardBottomViewport: Math.round(layout.boardY + layout.boardH + c.canvasPageY),
    });
  }
  out[c.tag] = res;
}
import { writeFileSync } from 'fs';
writeFileSync('/Users/zenghuanjia/WorkBuddy/2026-11-11-10-31-19/layout.json', JSON.stringify(out, null, 2));
for (const tag of Object.keys(out)) {
  console.log('===== ' + tag + ' =====');
  for (const lv of out[tag]) {
    console.log(`L${lv.level} ${lv.name} cols=${lv.cols} rows=${lv.rows} pieces=${lv.nPieces} cell=${lv.cell} board=(${lv.board.x},${lv.board.y} ${lv.board.w}x${lv.board.h}) trayTop=${lv.trayTop} trayH=${lv.trayH} boardBottomVP=${lv.boardBottomViewport}`);
    console.log('   tray: ' + lv.pieces.map((p) => `id${p.id}(${p.w}x${p.h})@${p.trayCenter} ang${p.angle} bbox${JSON.stringify(p.trayBBox)}`).join(' | '));
    if (lv.overlaps.length) console.log('   !! 托盘重叠: ' + JSON.stringify(lv.overlaps));
    if (lv.offCanvas.length) console.log('   !! 出画布: ' + JSON.stringify(lv.offCanvas));
    if (lv.offViewport.length) console.log('   !! 出视口: ' + JSON.stringify(lv.offViewport));
  }
}
