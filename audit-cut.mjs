/**
 * 1) 定位 shots-3-level6.png 底部被切断的拼块（列分布 + 是否带白色描边）
 * 2) 6 个角色：渲染 ASCII 亮度图，目视辨认 + 特征色统计
 */
import { decodePNG, px, lum } from './png.mjs';
import { chromium } from '/Users/zenghuanjia/.workbuddy/binaries/node/workspace/node_modules/playwright/index.mjs';

const ROOT = '/Users/zenghuanjia/WorkBuddy/2026-11-11-10-31-19/';

/* ---------- 1) 底部列分布 ---------- */
{
  const img = decodePNG(ROOT + 'shots-3-level6.png');
  console.log('=== shots-3-level6.png 最后一行 (y=779) 有内容的列区间 ===');
  const cols = [];
  for (let x = 0; x < img.w; x++) {
    const c = px(img, x, img.h - 1);
    const mx = Math.max(...c), mn = Math.min(...c);
    const s = mx ? (mx - mn) / mx : 0;
    if (s > 0.14 || lum(c) < 205) cols.push(x);
  }
  // 合并连续区间
  const ranges = [];
  for (const x of cols) {
    const last = ranges[ranges.length - 1];
    if (last && x - last[1] <= 3) last[1] = x; else ranges.push([x, x]);
  }
  console.log('  内容列区间:', ranges.map(([a, b]) => `${a}-${b}(${b - a + 1}px)`).join('  '));
  for (const [a, b] of ranges) {
    const c = px(img, Math.round((a + b) / 2), img.h - 1);
    console.log(`   区间 ${a}-${b} 底边像素 RGB=(${c.join(',')}) ${lum(c) < 205 ? '← 偏暗（很可能是图形被切断的断面）' : ''}`);
    // 该列向上的内容连续长度：若从底边一直连续到很上面，说明是一整块而不是被切一半
    let top = img.h - 1;
    for (let y = img.h - 1; y >= 0; y--) {
      const cc = px(img, Math.round((a + b) / 2), y);
      const mx = Math.max(...cc), mn = Math.min(...cc);
      const s = mx ? (mx - mn) / mx : 0;
      if (s <= 0.14 && lum(cc) >= 205) break;
      top = y;
    }
    console.log(`   → 该列内容从 y=${top} 一直连到 y=${img.h - 1}（连续 ${img.h - top}px）`);
  }
  // 白色描边检测：拼块边缘有 3-9px 白色描边，裁切处不会有白边
  console.log('\n  检查最底一行附近是否有拼块白色描边（描边=纯白近 (255,255,255)）:');
  let white = 0, cnt = 0;
  for (let x = 0; x < img.w; x++) { const c = px(img, x, img.h - 1); cnt++; if (c[0] > 246 && c[1] > 246 && c[2] > 246) white++; }
  console.log(`   最底一行纯白像素 ${white}/${cnt} → ${white > 20 ? '有描边（未被切断，是图形自然延续）' : '无描边（拼块被硬生生切断）'}`);
}

/* ---------- 2) 6 角色 ASCII ---------- */
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 400, height: 400 } });
await page.goto('file://' + ROOT + '拼图乐园.html', { waitUntil: 'load' });
await page.waitForTimeout(600);
const maps = await page.evaluate(() => {
  const kinds = ['dog', 'cat', 'rabbit', 'penguin', 'panda', 'chick'];
  const out = {};
  for (const k of kinds) {
    const w = 300, h = 300;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    // 直接用场景绘制函数：从单文件里没有导出，改为读取缩略图 canvas
    out[k] = null;
  }
  return out;
});
// 单文件版不暴露 drawScene，改用页面内已渲染的缩略图
const thumbs = await page.evaluate(() => {
  const cards = document.querySelectorAll('#levelList .levelCard');
  const out = [];
  for (const card of cards) {
    const cv = card.querySelector('canvas');
    const name = card.querySelector('.lvName').textContent;
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    const grid = [];
    const ramp = ' .:-=+*#%@';
    for (let gy = 0; gy < 30; gy++) {
      let line = '';
      for (let gx = 0; gx < 60; gx++) {
        const x = Math.round((gx + 0.5) / 60 * cv.width), y = Math.round((gy + 0.5) / 30 * cv.height);
        const i = (y * cv.width + x) * 4;
        const L = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        line += ramp[Math.min(9, Math.max(0, Math.floor((255 - L) / 25.6)))];
      }
      grid.push(line);
    }
    out.push({ name, grid });
  }
  return out;
});
for (const t of thumbs) {
  console.log(`\n--- ${t.name} 缩略图亮度图 (@=暗 .=亮) ---`);
  for (const l of t.grid) console.log('  ' + l);
}
await browser.close();
