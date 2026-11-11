/**
 * 单文件版验证：直接 file:// 打开（模拟用户双击）
 * 运行：node test-single.mjs
 */
import { chromium } from '/Users/zenghuanjia/.workbuddy/binaries/node/workspace/node_modules/playwright/index.mjs';

const FILE = 'file:///Users/zenghuanjia/WorkBuddy/2026-11-11-10-31-19/拼图乐园.html';

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 900, height: 780 } });

const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ✅ ' : '  ❌ ') + m); if (!c) fail++; };

await page.goto(FILE);
await page.waitForTimeout(1500);

console.log('\n[单文件 · file:// 直接打开]');
ok(await page.locator('#menu').isVisible(), '菜单正常显示');
ok(await page.locator('#levelList .levelCard').count() === 6, '关卡表渲染 6 张卡片');

await page.locator('#startBtn').click();
await page.waitForTimeout(900);
ok(await page.locator('#hud').isVisible(), '进入关卡，HUD 显示');

const dbg = await page.evaluate(() => (window.__debug ? window.__debug().length : -1));
ok(dbg === 2, '拼块数量正确：' + dbg);

// 拖一块试试
const info = await page.evaluate(() => {
  const p = window.__debug()[0];
  return { x: p.x, y: p.y, hx: p.home.x, hy: p.home.y };
});
await page.mouse.move(info.x, info.y);
await page.mouse.down();
await page.mouse.move(info.hx, info.hy, { steps: 20 });
await page.mouse.up();
await page.waitForTimeout(400);
const placed = await page.evaluate(() => window.__debug()[0].placed);
ok(placed === true, '拖拽吸附正常工作');

ok(errs.length === 0, '无 JS 报错' + (errs.length ? '：' + errs.join(' | ') : ''));

await page.screenshot({ path: '/tmp/single-file-play.png' });
await browser.close();

console.log(fail === 0 ? '\n单文件版通过 ✅\n' : '\n失败 ❌\n');
process.exit(fail === 0 ? 0 : 1);
