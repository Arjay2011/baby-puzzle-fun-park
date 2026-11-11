/**
 * 阶段 E（决定性验证）：
 *  1) 把整关拼块归位后，抓取画布实际像素，与场景参考图做相关匹配
 *     → 判断「拼块内容是否镜像 / 错位 / 缩放异常」
 *  2) 6 个角色美术质量指标（眼点检测、轮廓、对称性、区分度）
 */
import { chromium } from '/Users/zenghuanjia/.workbuddy/binaries/node/workspace/node_modules/playwright/index.mjs';
import { readFileSync } from 'fs';

const ROOT = '/Users/zenghuanjia/WorkBuddy/2026-11-11-10-31-19/';
const FILE = 'file://' + ROOT + '拼图乐园.html';

const partsSrc = readFileSync(ROOT + 'puzzle-parts.js', 'utf8')
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+(const|function|let|var|class)\s/gm, '$1 ')
  .replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, '');
const charsSrc = readFileSync(ROOT + 'characters.js', 'utf8')
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+(const|function|let|var|class)\s/gm, '$1 ')
  .replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, '');
const inject = `
${partsSrc}
${charsSrc}
window.__P = { LEVELS, buildLevel, computeLayout, drawScene, drawThumb };
`;

const browser = await chromium.launch({ channel: 'chrome' });

/* ---------- 1. 归位后 vs 参考图的配准 ---------- */
async function assembledCheck(levelIdx) {
  const page = await browser.newPage({ viewport: { width: 900, height: 780 } });
  await page.addInitScript(inject);
  await page.goto(FILE);
  await page.waitForTimeout(900);
  await page.locator('#levelList .levelCard').nth(levelIdx).click();
  await page.waitForTimeout(1000);
  for (let i = 0; i < 8; i++) {
    const info = await page.evaluate(() => { const p = window.__debug().find((q) => !q.placed); return p ? { x: p.x, y: p.y, hx: p.home.x, hy: p.home.y } : null; });
    if (!info) break;
    await page.mouse.move(info.x, info.y); await page.mouse.down();
    await page.mouse.move(info.hx, info.hy, { steps: 20 }); await page.mouse.up();
    await page.waitForTimeout(240);
  }
  await page.waitForTimeout(900);
  const r = await page.evaluate(() => {
    const mod = window.__P;
    const lv = mod.LEVELS[window.__lvIdx ?? 0];
    return null;
  }).catch(() => null);
  const res = await page.evaluate((idx) => {
    const mod = window.__P;
    const lv = mod.LEVELS[idx];
    const built = mod.buildLevel(lv, lv.id);
    const W = 900, H = 780;
    const layout = mod.computeLayout(built.pieces, lv.cols, lv.rows, W, H, { margin: 14, trayGap: 18, maxCell: 168, minCell: 48 });

    // 场景参考图
    const pw = 512, ph = Math.round(pw * (lv.rows / lv.cols));
    const scene = document.createElement('canvas'); scene.width = pw; scene.height = ph;
    mod.drawScene(scene.getContext('2d'), pw, ph, lv.kind, lv.pal);
    const sd = scene.getContext('2d').getImageData(0, 0, pw, ph).data;

    // 实际画布（拼块已归位）
    const cv = document.querySelector('#game');
    const ctx = cv.getContext('2d');
    const dpr = window.devicePixelRatio;
    const cd = ctx.getImageData(0, 0, cv.width, cv.height).data;

    const gray = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

    // 采样板面区域：屏幕坐标 (boardX..boardX+boardW, boardY..) → 画布像素 = 页面 y + hud 高
    const hudH = document.querySelector('#hud').getBoundingClientRect().height;
    const bx = layout.boardX, by = layout.boardY + hudH, bw = layout.boardW, bh = layout.boardH;
    const N = 40;
    const canvasSamples = [], sceneSamples = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const sx = Math.round((bx + (bw * (i + 0.5)) / N) * dpr);
      const sy = Math.round((by + (bh * (j + 0.5)) / N) * dpr);
      const si = (sy * cv.width + sx) * 4;
      canvasSamples.push(gray(cd, si));
      const tx = Math.round(((i + 0.5) / N) * pw), ty = Math.round(((j + 0.5) / N) * ph);
      const ti = (ty * pw + tx) * 4;
      sceneSamples.push(gray(sd, ti));
    }
    const norm = (a) => { const m = a.reduce((s, v) => s + v, 0) / a.length; return a.map((v) => v - m); };
    const corr = (a, b) => { const A = norm(a), B = norm(b); let s = 0, na = 0, nb = 0;
      for (let i = 0; i < A.length; i++) { s += A[i] * B[i]; na += A[i] * A[i]; nb += B[i] * B[i]; }
      return +(s / Math.sqrt(na * nb)).toFixed(4); };

    // 镜像 / 翻转 假设检验
    const mirX = sceneSamples.map((_, k) => { const j = Math.floor(k / N), i = k % N; return sceneSamples[j * N + (N - 1 - i)]; });
    const mirY = sceneSamples.slice().reverse();
    const rot180 = mirX.slice().reverse();

    return {
      level: lv.id, name: lv.name,
      corrNormal: corr(canvasSamples, sceneSamples),
      corrMirrorX: corr(canvasSamples, mirX),
      corrMirrorY: corr(canvasSamples, mirY),
      corrRot180: corr(canvasSamples, rot180),
      // 亮度一致性
      meanCanvas: +(canvasSamples.reduce((s, v) => s + v, 0) / canvasSamples.length).toFixed(1),
      meanScene: +(sceneSamples.reduce((s, v) => s + v, 0) / sceneSamples.length).toFixed(1),
      boardPx: { x: Math.round(bx), y: Math.round(by), w: Math.round(bw), h: Math.round(bh) },
    };
  }, levelIdx);
  await page.close();
  return res;
}

console.log('=== 归位后画布 vs 参考图 相关匹配 ===');
for (const idx of [0, 5, 2]) {
  const r = await assembledCheck(idx);
  console.log(`L${r.level} ${r.name}: corr正常=${r.corrNormal}  镜像X=${r.corrMirrorX}  镜像Y=${r.corrMirrorY}  旋转180=${r.corrRot180}  画布亮度=${r.meanCanvas} 参考亮度=${r.meanScene}`);
}

/* ---------- 2. 角色美术质量 ---------- */
{
  const page = await browser.newPage({ viewport: { width: 600, height: 600 } });
  await page.addInitScript(inject);
  await page.goto(FILE);
  await page.waitForTimeout(500);
  const arts = await page.evaluate(() => {
    const mod = window.__P;
    const kinds = ['dog', 'cat', 'rabbit', 'penguin', 'panda', 'chick'];
    const pals = ['meadow', 'sunny', 'lilac', 'polar', 'bamboo', 'aqua'];
    const out = [];
    for (let i = 0; i < kinds.length; i++) {
      const w = 400, h = 400;
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      mod.drawScene(c.getContext('2d'), w, h, kinds[i], pals[i]);
      const d = c.getContext('2d').getImageData(0, 0, w, h).data;
      const g = (x, y) => { const i = (y * w + x) * 4; return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; };
      const sat = (x, y) => { const i = (y * w + x) * 4; const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]); return mx ? (mx - mn) / mx : 0; };
      // 头部区域：设计坐标系 y 30..135 映射到画布
      // characterLayout: ground=0.87h, unit=min((ground-0.05h)/200, (w*0.56)/(200*0.65)), x=w/2-100*unit
      const ground = h * 0.87, unit = Math.min((ground - h * 0.05) / 200, (w * 0.56) / 130), x0 = w / 2 - 100 * unit;
      const toPx = (dx, dy) => [x0 + dx * unit, (ground - (190 - dy)) * unit];
      // 眼睛位置（各角色定义）
      const eyeDefs = {
        dog: [[82, 74], [118, 74]], cat: [[81, 80], [119, 80]], rabbit: [[82, 86], [118, 86]],
        penguin: [[83, 68], [117, 68]], panda: [[79, 80], [121, 80]], chick: [[84, 86], [116, 86]],
      }[kinds[i]];
      const eyeInfo = eyeDefs.map(([ex, ey]) => {
        const [px, py] = toPx(ex, ey);
        // 周围 5px 内最暗值与对比
        let minL = 999, maxL = -1;
        for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
          const x = Math.round(px + dx), y = Math.round(py + dy);
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          const L = g(x, y); minL = Math.min(minL, L); maxL = Math.max(maxL, L);
        }
        const [cxp, cyp] = toPx(100, ey);
        return { px: +px.toFixed(1), py: +py.toFixed(1), contrast: +(maxL - minL).toFixed(0), dark: minL < 90 };
      });
      // 头部/身体比例：头半径 vs 身体
      const headDefs = { dog: [58, 53], cat: [55, 50], rabbit: [53, 48], penguin: [44, 40], panda: [55, 50], chick: [47, 43] }[kinds[i]];
      const bodyDefs = { dog: [44, 38], cat: [42, 36], rabbit: [40, 34], penguin: [46, 54], panda: [43, 37], chick: [50, 50] }[kinds[i]];
      // 左右对称性（灰度图）
      let symErr = 0, symN = 0;
      for (let y = 0; y < h; y += 2) for (let x = 0; x < w / 2; x += 2) { symErr += Math.abs(g(x, y) - g(w - 1 - x, y)); symN++; }
      // 高光/纯白像素占比（判断是否糊成一片）
      let white = 0, black = 0, n = 0, satSum = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4;
        const L = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        if (L > 250) white++; if (L < 25) black++; n++; satSum += sat(x, y); }
      out.push({
        kind: kinds[i], pal: pals[i], unit: +unit.toFixed(3),
        eyeContrast: eyeInfo.map((e) => e.contrast),
        eyesBothDark: eyeInfo.every((e) => e.dark),
        eyeSizePx: +(eyeInfo[0].contrast > 0 ? 2 * 0 : 0),
        headBodyRatio: +(headDefs[0] / bodyDefs[0]).toFixed(2),
        headWidthUnits: headDefs[0], headPx: +(headDefs[0] * unit).toFixed(1),
        symmetryErr: +(symErr / symN).toFixed(1),
        whitePct: +(white / n * 100).toFixed(1), blackPct: +(black / n * 100).toFixed(1),
        avgSat: +(satSum / n).toFixed(3),
      });
    }
    return out;
  });
  console.log('\n=== 6 角色美术指标 ===');
  for (const a of arts) {
    console.log(`${a.kind.padEnd(8)} 眼对比度=${JSON.stringify(a.eyeContrast)} 双眼可见=${a.eyesBothDark} 头宽=${a.headPx}px 头/身=${a.headBodyRatio} 左右对称误差=${a.symmetryErr} 纯白=${a.whitePct}% 纯黑=${a.blackPct}% 平均饱和=${a.avgSat}`);
  }
  await page.close();
}
await browser.close();
