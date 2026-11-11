/**
 * 拼图几何核心（纯逻辑，无 DOM 依赖）
 *
 * 坐标系：单位 = 1 个格子。板面 cols×rows，格子为正方形。
 * cells[row][col] = 拼块编号；同一编号的格子合并为一块（可组成 L 形）。
 * 相邻拼块的公共边上生成「颈部圆弧 + 圆头」的真榫卯。
 */

export const LEVELS = [
  { id: 1, kind: 'dog',     name: '小狗豆豆', cols: 2, rows: 1, cells: [[0, 1]],                          pal: 'meadow'  },
  { id: 2, kind: 'cat',     name: '小猫团子', cols: 1, rows: 2, cells: [[0], [1]],                          pal: 'sunny'   },
  { id: 3, kind: 'rabbit',  name: '小兔奶糖', cols: 2, rows: 2, cells: [[0, 1], [2, 2]],                    pal: 'lilac' },
  { id: 4, kind: 'penguin', name: '企鹅冰冰', cols: 2, rows: 2, cells: [[0, 1], [0, 2]],                    pal: 'polar'   },
  { id: 5, kind: 'panda',   name: '熊猫圆圆', cols: 2, rows: 2, cells: [[0, 1], [2, 3]],                    pal: 'bamboo'  },
  { id: 6, kind: 'chick',   name: '小鸡啾啾', cols: 3, rows: 2, cells: [[0, 0, 1], [2, 3, 3]],              pal: 'aqua'    },
];

/* ---------------- 工具 ---------------- */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* ---------------- 榫卯轮廓 ---------------- */
/**
 * 生成一条带榫卯的边的采样点。返回点列从 a 指向 b。
 *
 * 形状：直线段 → 颈部切线 → 圆头圆弧 → 颈部切线 → 直线段
 * 几何推导：圆头圆心落在边的中点（与基线共线），半径 r；
 *   颈部基点距圆心 w = 1.4r，由切线条件 sin α = r/w 得出切点。
 * bulge 为绝对凸起方向（单位向量），保证相邻两块得到同一条曲线。
 */
export function edgeProfile(a, b, bulge, steps = 16) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = Math.hypot(dx, dy);
  if (L < 1e-6) return [[a[0], a[1]], [b[0], b[1]]];

  const d = [dx / L, dy / L];
  const perp = [-d[1], d[0]];
  const s = Math.sign(bulge[0] * perp[0] + bulge[1] * perp[1]) || 1;

  const r = 0.20 * L;        // 圆头半径
  const w = 1.40 * r;        // 颈部基点偏移
  const alpha = Math.asin(r / w);
  const ca = Math.cos(alpha), sa = Math.sin(alpha);

  const M = [a[0] + dx * 0.5, a[1] + dy * 0.5];
  const N1 = [M[0] - d[0] * w, M[1] - d[1] * w];
  const T1 = [M[0] - d[0] * r * sa + perp[0] * r * ca, M[1] - d[1] * r * sa + perp[1] * r * ca];
  const T2 = [M[0] + d[0] * r * sa + perp[0] * r * ca, M[1] + d[1] * r * sa + perp[1] * r * ca];
  const N2 = [M[0] + d[0] * w, M[1] + d[1] * w];

  const pts = [[a[0], a[1]], [N1[0], N1[1]], [T1[0], T1[1]]];
  const th1 = Math.atan2(ca, -sa);   // 切点 T1 的极角（基底 d / perp）
  const th2 = Math.atan2(ca, sa);    // 切点 T2 的极角
  for (let i = 1; i < steps; i++) {
    const th = th1 + (th2 - th1) * (i / steps);
    const ux = Math.cos(th) * r, uy = Math.sin(th) * r;
    pts.push([M[0] + d[0] * ux + perp[0] * uy, M[1] + d[1] * ux + perp[1] * uy]);
  }
  pts.push([T2[0], T2[1]], [N2[0], N2[1]], [b[0], b[1]]);

  // 凸起方向与 perp 反向时，沿边线镜像整个轮廓
  if (s < 0) {
    for (const p of pts) {
      const vx = p[0] - M[0], vy = p[1] - M[1];
      const along = vx * d[0] + vy * d[1];
      const pc = -(vx * perp[0] + vy * perp[1]);
      p[0] = M[0] + d[0] * along + perp[0] * pc;
      p[1] = M[1] + d[1] * along + perp[1] * pc;
    }
  }
  return pts;
}

/* ---------------- 关卡 → 拼块 ---------------- */

/**
 * @param {object} level
 * @param {number} seed 随机种子，决定榫卯朝向
 */
export function buildLevel(level, seed = 1) {
  const { cols, rows, cells } = level;
  const rnd = mulberry32(seed * 7919 + 13);

  // 1. 收集全部内部边（相邻且属于不同拼块）
  const edges = new Map();   // key -> {axis, line, seg, bulge}
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const id = cells[r][c];
      if (c + 1 < cols && cells[r][c + 1] !== id) {
        edges.set(`V_${c + 1}_${r}`, { axis: 'V', line: c + 1, seg: r, bulge: [rnd() < 0.5 ? 1 : -1, 0] });
      }
      if (r + 1 < rows && cells[r + 1][c] !== id) {
        edges.set(`H_${r + 1}_${c}`, { axis: 'H', line: r + 1, seg: c, bulge: [0, rnd() < 0.5 ? 1 : -1] });
      }
    }
  }
  // 避免所有榫卯朝同一侧，改为左右交替
  const vKeys = [...edges.keys()].filter((k) => k.startsWith('V_'));
  const hKeys = [...edges.keys()].filter((k) => k.startsWith('H_'));
  vKeys.forEach((k, i) => { edges.get(k).bulge = [i % 2 === 0 ? 1 : -1, 0]; });
  hKeys.forEach((k, i) => { edges.get(k).bulge = [0, i % 2 === 0 ? 1 : -1]; });

  // 2. 按拼块分组
  const groups = new Map();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const id = cells[r][c];
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push([r, c]);
    }
  }

  const pieces = [];
  for (const [id, list] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    const minCol = Math.min(...list.map((p) => p[1]));
    const maxCol = Math.max(...list.map((p) => p[1]));
    const minRow = Math.min(...list.map((p) => p[0]));
    const maxRow = Math.max(...list.map((p) => p[0]));

    // 拼块自身的重心（相对 minCol/minRow，单位：格）
    const cx = list.reduce((s, p) => s + p[1] + 0.5, 0) / list.length - minCol;
    const cy = list.reduce((s, p) => s + p[0] + 0.5, 0) / list.length - minRow;

    // 收集有向边界线段（顺时针，单位坐标）
    const segs = [];
    const push = (key, a, b, axis) => {
      const e = edges.get(key);
      segs.push({ a, b, internal: !!e, bulge: e ? e.bulge : null, axis });
    };
    for (const [r, c] of list) {
      const up = r - 1 >= 0 ? cells[r - 1][c] : -1;
      const dn = r + 1 < rows ? cells[r + 1][c] : -1;
      const lf = c - 1 >= 0 ? cells[r][c - 1] : -1;
      const rt = c + 1 < cols ? cells[r][c + 1] : -1;
      if (up !== id) push(`H_${r}_${c}`, [c, r], [c + 1, r], 'H');
      if (rt !== id) push(`V_${c + 1}_${r}`, [c + 1, r], [c + 1, r + 1], 'V');
      if (dn !== id) push(`H_${r + 1}_${c}`, [c + 1, r + 1], [c, r + 1], 'H');
      if (lf !== id) push(`V_${c}_${r}`, [c, r + 1], [c, r], 'V');
    }

    // 串成闭环：每个顶点恰好一条出边
    const key = (p) => `${p[0].toFixed(4)}|${p[1].toFixed(4)}`;
    const startMap = new Map();
    segs.forEach((s, i) => startMap.set(key(s.a), i));
    const order = [];
    let cur = 0;
    for (let guard = 0; guard <= segs.length; guard++) {
      order.push(cur);
      const nxt = startMap.get(key(segs[cur].b));
      if (nxt === undefined || nxt === cur) break;
      cur = nxt;
    }

    // 采样成点列
    const pts = [];
    for (const si of order) {
      const s = segs[si];
      const seq = s.internal
        ? edgeProfile(s.a, s.b, s.bulge)
        : [s.a, s.b];
      for (const p of seq) {
        const last = pts[pts.length - 1];
        if (!last || Math.abs(last[0] - p[0]) > 1e-6 || Math.abs(last[1] - p[1]) > 1e-6) pts.push(p);
      }
    }

    pieces.push({
      id,
      cells: list,
      minCol, maxCol, minRow, maxRow,
      wCells: maxCol - minCol + 1,
      hCells: maxRow - minRow + 1,
      // 以拼块重心为原点的轮廓（单位坐标）
      poly: pts.map((p) => [p[0] - minCol - cx, p[1] - minRow - cy]),
      // 拼块重心在板面中的位置（单位坐标）
      anchor: [minCol + cx, minRow + cy],
    });
  }

  return { pieces };
}

/* ---------------- 命中测试 ---------------- */

export function pointInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1];
    const xj = pts[j][0], yj = pts[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* ---------------- 布局 ---------------- */

/**
 * 计算板面尺寸 + 零件托盘布局
 *
 * 关键约束：拼块带榫卯且会随机旋转，实际占位比「格子数 × cell」大。
 * 所以托盘区必须按「拼块真实外接尺寸」来分配空间，否则拼块会被画布边缘裁掉。
 *
 * @returns {{cell, boardX, boardY, boardW, boardH, trayTop, trayH, slots}}
 */
export function computeLayout(pieces, cols, rows, availW, availH, opts = {}) {
  const MARGIN = opts.margin ?? 18;
  const GAP = opts.trayGap ?? 24;
  const MAX_CELL = opts.maxCell ?? 190;
  const MIN_CELL = opts.minCell ?? 56;

  const n = pieces.length;
  const maxHC = Math.max(...pieces.map((p) => p.hCells));
  const maxWC = Math.max(...pieces.map((p) => p.wCells));

  // 榫卯外扩：轮廓会比格子边界多出约 0.2 格
  const KNOB = 0.42;   // 拼块实际占位 = 格子数 + 榫卯外扩
  const PAD = 1.0;     // 旋转与阴影的安全余量（格）

  // 托盘候选：1 行 或 2 行（按宽度贪心均衡分配）
  const candidates = [];
  candidates.push([pieces.map((_, i) => i)]);
  if (n >= 3) {
    const order = pieces.map((_, i) => i).sort((a, b) => pieces[b].wCells - pieces[a].wCells);
    const rowsTmp = [[], []];
    for (const i of order) {
      const wA = rowsTmp[0].reduce((s, j) => s + pieces[j].wCells, 0);
      const wB = rowsTmp[1].reduce((s, j) => s + pieces[j].wCells, 0);
      (wA <= wB ? rowsTmp[0] : rowsTmp[1]).push(i);
    }
    if (rowsTmp[1].length) candidates.push(rowsTmp);
  }

  let best = null;
  for (const part of candidates) {
    // 每行占位宽度（含榫卯外扩）
    const rowUnits = part.map((row) =>
      row.reduce((s, i) => s + pieces[i].wCells, 0) + KNOB * row.length + PAD);
    const maxRowUnits = Math.max(...rowUnits);
    // 每行占位高度
    const rowHeights = part.map((row) =>
      Math.max(...row.map((i) => pieces[i].hCells)) + KNOB + PAD);
    const trayUnits = rowHeights.reduce((s, v) => s + v, 0);

    // 宽度约束：板面与托盘都放得下
    const sW = (availW - MARGIN * 2) / Math.max(cols, maxRowUnits);
    // 高度约束：板面高度 + 托盘各行高度
    const sH = (availH - MARGIN * 2 - GAP) / (rows + trayUnits);
    const cell = Math.min(sW, sH, MAX_CELL);
    if (cell < MIN_CELL) continue;
    if (!best || cell > best.cell) best = { cell, part, rowUnits, rowHeights };
  }
  if (!best) {
    // 兜底：塞满可用空间
    const cell = Math.max(MIN_CELL * 0.6,
      Math.min((availW - MARGIN * 2) / cols, (availH - MARGIN * 2) / (rows + 2)));
    best = { cell, part: [pieces.map((_, i) => i)], rowUnits: [n * 2], rowHeights: [maxHC + 2] };
  }

  const cell = best.cell;
  const boardW = cols * cell, boardH = rows * cell;
  const boardX = (availW - boardW) / 2;
  const boardY = MARGIN;
  const trayTop = boardY + boardH + GAP;
  const trayH = Math.max(40, availH - trayTop - MARGIN);

  // 零件槽位：按各行占位宽度分配 x，按占位高度分配 y
  const rnd = mulberry32(20260611);
  const slots = [];
  let yCursor = trayTop;
  best.part.forEach((row, ri) => {
    const units = best.rowUnits[ri];
    const bandUnits = best.rowHeights[ri];
    const bandH = bandUnits * cell;          // 该行的占位高度
    const rowW = units * cell;                // 该行的占位宽度
    let x = (availW - rowW) / 2;
    for (const i of row) {
      const p = pieces[i];
      const w = p.wCells * cell;
      slots.push({
        index: i,
        x: x + w / 2,
        y: yCursor + bandH / 2,
        jitterX: (rnd() - 0.5) * Math.min(14, cell * 0.12),
        jitterY: (rnd() - 0.5) * Math.min(12, cell * 0.1),
        angle: (rnd() - 0.5) * 0.22,
      });
      x += w + KNOB * cell * 0.5;
    }
    yCursor += bandH;
  });

  return { cell, boardX, boardY, boardW, boardH, trayTop, trayH, slots };
}
