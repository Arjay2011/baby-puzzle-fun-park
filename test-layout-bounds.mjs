/**
 * 布局边界回归测试：确保拼块完整落在画布内、互不重叠
 *
 * 曾出现的问题：托盘拼块被画布边缘裁切（第6关底部溢出 53px、右侧溢出 54px，
 * 手机版左右各溢出 26-28px），根因是边界约束用了固定系数而非拼块真实占位。
 *
 * 运行：node test-layout-bounds.mjs
 */
import { chromium } from '/Users/zenghuanjia/.workbuddy/binaries/node/workspace/node_modules/playwright/index.mjs';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { extname, join, normalize } from 'path';

const ROOT = new URL('.', import.meta.url).pathname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!existsSync(file)) { res.writeHead(404); res.end('nf'); return; }
  res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream');
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(8904, r));

const browser = await chromium.launch({ channel: 'chrome' });

let fail = 0;
const ok = (c, m) => { console.log(`${c ? '  ✅' : '  ❌'} ${m}`); if (!c) fail++; };

const VIEWPORTS = [
  { name: '桌面 900×780', w: 900, h: 780 },
  { name: '手机 390×844', w: 390, h: 844 },
  { name: '小屏 360×640', w: 360, h: 640 },
  { name: '横屏 844×390', w: 844, h: 390 },
];

for (const vp of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
  page.on('pageerror', (e) => console.log('[error]', e.message));
  await page.goto('http://localhost:8904/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  console.log(`\n[${vp.name}]`);

  for (let lv = 0; lv < 6; lv++) {
    await page.evaluate((i) => {
      const cards = document.querySelectorAll('#levelList .levelCard');
      if (cards[i]) cards[i].click();
    }, lv);
    await page.waitForTimeout(650);

    const r = await page.evaluate(() => {
      const info = window.__bounds();
      return info;
    });

    // 画布本身不能溢出视口
    ok(r.canvasOverflow <= 1,
      `L${lv + 1} 画布未溢出视口（溢出 ${r.canvasOverflow.toFixed(1)}px）`);

    // 每块拼图必须完整在画布内
    const bad = r.overflows.filter((o) => o.over > 1.5);
    ok(bad.length === 0,
      `L${lv + 1} 拼块完整在画布内` +
      (bad.length ? `（越界: ${bad.map((b) => `块${b.id}超${b.over.toFixed(0)}px`).join(', ')}）` : ''));

    // 拼块之间不能重叠
    ok(r.maxOverlap < 400,
      `L${lv + 1} 拼块无明显重叠（最大交叠 ${r.maxOverlap.toFixed(0)}px²）`);

    // 拼块不能压到目标板上
    ok(r.overBoard === 0, `L${lv + 1} 散落拼块未压住目标板`);
  }
  await page.close();
}

await browser.close();
server.close();
console.log(fail === 0 ? '\n全部通过 ✅\n' : `\n${fail} 项失败 ❌\n`);
process.exit(fail === 0 ? 0 : 1);
