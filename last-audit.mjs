/**
 * 阶段 H（收尾量化）：缩略图渲染、关键对比度、裁切实测
 */
import { decodePNG, px, hex, lum } from './png.mjs';
import { readFileSync } from 'fs';

const ROOT = '/Users/zenghuanjia/WorkBuddy/2026-11-11-10-31-19/';
const cr = (a, b) => ((Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)).toFixed(2);

/* 1) 6 张缩略图（菜单用）渲染检查 */
console.log('=== 关卡缩略图（菜单 110x110 显示） ===');
for (const k of ['dog', 'cat', 'rabbit', 'penguin', 'panda', 'chick']) {
  const img = decodePNG(ROOT + `art-${k}_thumb.png`);
  let n = 0, uniq = new Set(), satSum = 0, dark = 0, minL = 999, maxL = -1;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    const [r, g, b] = px(img, x, y);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    satSum += mx ? (mx - mn) / mx : 0; n++;
    uniq.add((r >> 4) + ',' + (g >> 4) + ',' + (b >> 4));
    const L = lum([r, g, b]); minL = Math.min(minL, L); maxL = Math.max(maxL, L);
    if (L < 80) dark++;
  }
  console.log(`${k.padEnd(8)} ${img.w}x${img.h} 颜色数=${String(uniq.size).padStart(3)} 平均饱和=${(satSum / n).toFixed(3)} 暗像素=${(dark / n * 100).toFixed(1)}% 亮度范围=${minL.toFixed(0)}..${maxL.toFixed(0)}`);
}

/* 2) 关键对比度 */
console.log('\n=== 关键对比度 (WCAG AA 正文需 4.5，大字/图形需 3.0) ===');
const rows = [
  ['正文棕字 vs 奶油底', [122, 91, 58], [255, 248, 236]],
  ['菜单副标题 14px vs 面板底', [122, 91, 58], [255, 248, 236]],
  ['关卡名 14px vs 白卡片', [122, 91, 58], [255, 255, 255]],
  ['HUD 关卡名 17px vs HUD 底', [122, 91, 58], [255, 253, 247]],
  ['HUD 星星金 vs HUD 底', [255, 210, 74], [255, 253, 247]],
  ['结算金星 52px vs 面板底', [255, 210, 74], [255, 248, 236]],
  ['结算未得星 vs 面板底', [228, 216, 196], [255, 248, 236]],
  ['主按钮白字 vs 绿底', [255, 255, 255], [63, 174, 124]],
  ['副按钮白字 vs 橙底', [255, 255, 255], [255, 140, 66]],
  ['虚线凹槽 vs 板白底', [197, 176, 153], [255, 253, 248]],
  ['淡参考图(alpha.16) vs 板白底', [233, 240, 248], [255, 253, 248]],
  ['白色描边 vs 场景深色', [255, 255, 255], [90, 60, 35]],
];
for (const [name, a, b] of rows) {
  const v = cr(a, b);
  const verdict = v >= 4.5 ? 'AA正文' : v >= 3 ? '仅大字/图形' : '不足';
  console.log(`${name.padEnd(30)} ${String(v).padStart(6)}  ${verdict}`);
}

/* 3) 裁切实测：直接从真实截图找被切掉的拼块 */
console.log('\n=== 裁切实测（检查截图最底部 30px 是否存在被切断的图形边缘） ===');
for (const f of ['shots-2-level1.png', 'shots-3-level6.png']) {
  const img = decodePNG(ROOT + f);
  // 统计最底部 3 行的"非背景"像素比例（背景是奶油渐变 #FFF8EC→#FFEEDC）
  for (const band of [4, 12, 30]) {
    let hit = 0, n = 0;
    for (let y = img.h - band; y < img.h; y++) for (let x = 0; x < img.w; x++) {
      const [r, g, b] = px(img, x, y); n++;
      // 背景色附近（高亮度、低饱和、暖白）视为空白
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const sat = mx ? (mx - mn) / mx : 0;
      if (sat > 0.10 || lum([r, g, b]) < 225) hit++;
    }
    console.log(`${f} 底部${band}px 非背景占比 = ${(hit / n * 100).toFixed(1)}%`);
  }
}

/* 4) 真实截图里托盘拼块的「有角色内容」判定 */
console.log('\n=== 真实截图：每块拼块内是否含角色特征（棕色/彩色毛发 + 深色五官） ===');
const img2 = decodePNG(ROOT + 'shots-2-level1.png');
const img3 = decodePNG(ROOT + 'shots-3-level6.png');
function analyze(img, name, boxes) {
  boxes.forEach((b, i) => {
    let n = 0, dark = 0, brown = 0, white = 0, uniq = new Set(), satSum = 0;
    for (let y = b[1]; y < Math.min(b[3], img.h); y++) for (let x = b[0]; x < b[2]; x++) {
      const [r, g, b] = px(img, x, y);
      const L = lum([r, g, b]); const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      n++; satSum += mx ? (mx - mn) / mx : 0;
      uniq.add((r >> 4) + ',' + (g >> 4) + ',' + (b >> 4));
      if (L < 85) dark++;
      if (r > 110 && r < 205 && g > 55 && g < 135 && b < 95) brown++;
      if (L > 245) white++;
    }
    console.log(`  ${name} 块${i}: 颜色数=${String(uniq.size).padStart(3)} 饱和=${(satSum / n).toFixed(3)} 深色(五官/描边)=${(dark / n * 100).toFixed(2)}% 棕毛=${(brown / n * 100).toFixed(1)}% 纯白=${(white / n * 100).toFixed(1)}%`);
  });
}
// shots-2: id0 bbox [275,459]-[477,627], id1 [453,459]-[621,627]
analyze(img2, 'L1狗', [[278, 462, 474, 624], [456, 462, 618, 624]]);
// shots-3: 4 块
analyze(img3, 'L6鸡', [[194, 446, 558, 642], [540, 446, 702, 642], [534, 654, 696, 779], [168, 614, 532, 779]]);
