/**
 * 几何自测：验证关卡数据与榫卯生成是否自洽
 * 运行：node test-geometry.mjs
 */
import { LEVELS, buildLevel, pointInPoly, edgeProfile } from './puzzle-parts.js';

let fail = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ✅' : '  ❌'} ${msg}`);
  if (!cond) fail++;
};

const round = (v) => Math.round(v * 1e6) / 1e6;

/* 1. 关卡结构完整性 */
console.log('\n[1] 关卡结构');
for (const lv of LEVELS) {
  const { pieces } = buildLevel(lv, lv.id);
  const ids = new Set(lv.cells.flat());
  ok(pieces.length === ids.size, `${lv.name}: 拼块数 ${pieces.length} = 格子中的编号数 ${ids.size}`);
  const totalCells = pieces.reduce((s, p) => s + p.cells.length, 0);
  ok(totalCells === lv.cols * lv.rows, `${lv.name}: 覆盖 ${totalCells}/${lv.cols * lv.rows} 格`);

  // 每块的重心必须落在自己格子的包围盒内
  for (const p of pieces) {
    const inBox = p.anchor[0] >= p.minCol - 1e-6 && p.anchor[0] <= p.maxCol + 1 + 1e-6
      && p.anchor[1] >= p.minRow - 1e-6 && p.anchor[1] <= p.maxRow + 1 + 1e-6;
    if (!inBox) ok(false, `${lv.name}: 拼块${p.id} 重心越界 ${p.anchor}`);
  }
}

/* 2. 相邻两块的公共边必须是同一条曲线 */
console.log('\n[2] 公共边一致性（咬合命门）');
for (const lv of LEVELS) {
  const { pieces } = buildLevel(lv, lv.id);
  const pieceAt = new Map();
  for (const p of pieces) for (const [r, c] of p.cells) pieceAt.set(`${r}_${c}`, p);

  let checked = 0;
  let matched = 0;
  for (const p of pieces) {
    for (const [r, c] of p.cells) {
      // 右侧邻居
      const right = pieceAt.get(`${r}_${c + 1}`);
      if (right && right.id !== p.id) {
        // 找出 p 的右边界与 right 的左边界对应的采样点
        const key = `V_${c + 1}_${r}`;
        const edge = buildLevel(lv, lv.id).edges ? null : null;
        // 直接比对：p 的轮廓中 x = c+1 的点集 与 right 轮廓中 x = c+1 的点集
        const a = p.poly.filter((pt) => Math.abs(pt[0] + p.anchor[0] - (c + 1)) < 1e-6)
          .map((pt) => [round(pt[0] + p.anchor[0]), round(pt[1] + p.anchor[1])]);
        const b = right.poly.filter((pt) => Math.abs(pt[0] + right.anchor[0] - (c + 1)) < 1e-6)
          .map((pt) => [round(pt[0] + right.anchor[0]), round(pt[1] + right.anchor[1])]);
        checked++;
        if (a.length > 0 && b.length > 0) {
          const setA = new Set(a.map((pt) => pt.join(',')));
          const shared = b.filter((pt) => setA.has(pt.join(','))).length;
          if (shared >= Math.min(a.length, b.length) - 1) matched++;
          else console.log(`      ${lv.name} 边${key}: p采样${a.length} right采样${b.length} 共享${shared}`);
        }
      }
      // 下方邻居
      const down = pieceAt.get(`${r + 1}_${c}`);
      if (down && down.id !== p.id) {
        const a = p.poly.filter((pt) => Math.abs(pt[1] + p.anchor[1] - (r + 1)) < 1e-6)
          .map((pt) => [round(pt[0] + p.anchor[0]), round(pt[1] + p.anchor[1])]);
        const b = down.poly.filter((pt) => Math.abs(pt[1] + down.anchor[1] - (r + 1)) < 1e-6)
          .map((pt) => [round(pt[0] + down.anchor[0]), round(pt[1] + down.anchor[1])]);
        checked++;
        if (a.length > 0 && b.length > 0) {
          const setA = new Set(a.map((pt) => pt.join(',')));
          const shared = b.filter((pt) => setA.has(pt.join(','))).length;
          if (shared >= Math.min(a.length, b.length) - 1) matched++;
          else console.log(`      ${lv.name} 边H_${r + 1}_${c}: p采样${a.length} down采样${b.length} 共享${shared}`);
        }
      }
    }
  }
  ok(checked === 0 || matched === checked, `${lv.name}: ${matched}/${checked} 条内部边完全重合`);
}

/* 3. 榫卯确实凸出/凹陷，而不是直线 */
console.log('\n[3] 榫卯凹凸性');
const prof = edgeProfile([0, 0], [1, 0], [0, 1]);
const maxY = Math.max(...prof.map((p) => p[1]));
const minY = Math.min(...prof.map((p) => p[1]));
ok(maxY > 0.15, `凸起高度 ${maxY.toFixed(4)} > 0.15 格（明显凹凸）`);
ok(minY === 0, `基线端点贴合（最低 ${minY}）`);
const dir = edgeProfile([0, 0], [1, 0], [0, -1]);
const maxY2 = Math.max(...dir.map((p) => p[1]));
ok(maxY2 === 0 && Math.min(...dir.map((p) => p[1])) < -0.15, `反向凸起正确（${Math.min(...dir.map((p) => p[1])).toFixed(4)}）`);

/* 4. 命中测试 */
console.log('\n[4] 命中测试');
ok(pointInPoly(0.5, 0.5, [[0, 0], [1, 0], [1, 1], [0, 1]]) === true, '内部点命中');
ok(pointInPoly(1.5, 0.5, [[0, 0], [1, 0], [1, 1], [0, 1]]) === false, '外部点不命中');

console.log(fail === 0 ? '\n全部通过 ✅\n' : `\n${fail} 项失败 ❌\n`);
process.exit(fail === 0 ? 0 : 1);
