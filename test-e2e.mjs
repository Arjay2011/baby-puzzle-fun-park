/**
 * 端到端测试：真实浏览器中驱动游戏，验证拖拽/吸附/流程
 * 运行：node test-e2e.mjs
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
await new Promise((r) => server.listen(8901, r));

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 900, height: 780 }, deviceScaleFactor: 1 });

const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

let fail = 0;
const ok = (c, m) => { console.log(`${c ? '  ✅' : '  ❌'} ${m}`); if (!c) fail++; };

await page.goto('http://localhost:8901/', { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

console.log('\n[1] 初始加载');
ok(await page.locator('#menu').isVisible(), '开始菜单可见');
ok(await page.locator('#levelList .levelCard').count() === 6, '关卡表渲染出 6 张卡片');
ok(errors.length === 0, `无 JS 报错${errors.length ? '：' + errors.join(' | ') : ''}`);

console.log('\n[2] 进入第 1 关（2 片）');
await page.locator('#startBtn').click();
await page.waitForTimeout(700);
ok(await page.locator('#hud').isVisible(), 'HUD 顶栏出现');
const st = await page.evaluate(() => ({
  level: document.querySelector('#levelName').textContent,
  attempt: document.querySelector('#attemptCount').textContent,
}));
ok(st.level.includes('小狗豆豆'), `关卡名正确：${st.level}`);
ok(st.attempt.includes('第 1 / 6 关'), `进度显示正确：${st.attempt}`);

console.log('\n[3] 拖拽拼块 → 吸附归位');
// 读取拼块当前屏幕坐标
const pieceInfo = await page.evaluate(() => {
  // 从 canvas 里的 pieces 找第一块未放置的
  const w = window;
  return w.__debug ? w.__debug() : null;
});
if (!pieceInfo) {
  console.log('  ⚠️ 未暴露调试接口，跳过精确拖拽测试');
} else {
  ok(pieceInfo.length >= 2, `场景中有 ${pieceInfo.length} 块拼图`);
  const before = await page.evaluate(() => window.__debug()[0]);
  const target = await page.evaluate(() => window.__debug()[0].home);
  await page.mouse.move(before.x, before.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 24 });
  await page.mouse.up();
  await page.waitForTimeout(450);
  const after = await page.evaluate(() => window.__debug()[0]);
  ok(after.placed === true, '拼块已吸附归位（placed=true）');
  ok(Math.abs(after.x - target.x) < 2 && Math.abs(after.y - target.y) < 2,
    `归位坐标精确 (${after.x.toFixed(1)},${after.y.toFixed(1)})`);
}

console.log('\n[4] 完成全部拼块 → 通关结算');
{
  // 逐块拖到目标位置
  for (let i = 0; i < 8; i++) {
    const info = await page.evaluate(() => {
      const list = window.__debug();
      const p = list.find((q) => !q.placed);
      return p ? { x: p.x, y: p.y, hx: p.home.x, hy: p.home.y, placed: p.placed } : null;
    });
    if (!info) break;
    await page.mouse.move(info.x, info.y);
    await page.mouse.down();
    await page.mouse.move(info.hx, info.hy, { steps: 20 });
    await page.mouse.up();
    await page.waitForTimeout(320);
  }
  await page.waitForTimeout(1400);
  ok(await page.locator('#complete').isVisible(), '通关结算面板出现');
  const winStars = await page.locator('#winStars .wstar.on').count();
  ok(winStars >= 1, `获得 ${winStars} 颗星`);
  const title = await page.locator('#winTitle').textContent();
  ok(title.includes('完成'), `结算标题：${title}`);
}

console.log('\n[5] 下一关 / 关卡表');
{
  await page.locator('#nextBtn').click();
  await page.waitForTimeout(800);
  const lv = await page.locator('#levelName').textContent();
  ok(lv.includes('小猫团子'), `进入第 2 关：${lv}`);
  await page.locator('#menuBtn').click();
  await page.waitForTimeout(500);
  ok(await page.locator('#menu').isVisible(), '可返回关卡表');
  const starTexts = await page.locator('#levelList .lvStars').first().textContent();
  ok(starTexts.includes('★'), `第 1 关星级已保存：${starTexts}`);
}

console.log('\n[6] 参考图弹窗');
{
  await page.locator('.levelCard').first().click();
  await page.waitForTimeout(700);
  await page.locator('#refBtn').click();
  await page.waitForTimeout(500);
  ok(await page.locator('#refModal').isVisible(), '参考图弹窗打开');
  const dims = await page.evaluate(() => {
    const c = document.querySelector('#refCanvas');
    return { w: c.width, h: c.height };
  });
  ok(dims.w > 100 && dims.h > 100, `参考图尺寸 ${dims.w}×${dims.h}`);
  await page.locator('#closeRef').click();
  await page.waitForTimeout(400);
  ok(await page.locator('#refModal').isHidden(), '参考图可关闭');
}

console.log('\n[7] 移动端竖屏适配');
{
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  const m = await page.evaluate(() => {
    const c = document.querySelector('#game');
    const r = c.getBoundingClientRect();
    return { w: r.width, h: r.height, vw: innerWidth, vh: innerHeight };
  });
  ok(Math.abs(m.w - m.vw) < 2, `画布宽度铺满视口 (${m.w} vs ${m.vw})`);
  ok(m.h > 200, `画布高度 ${m.h} 足够操作`);
  await page.screenshot({ path: '/tmp/e2e-mobile.png' });
}

console.log('\n[8] 全流程无 JS 报错');
ok(errors.length === 0, `错误列表为空${errors.length ? '：' + errors.slice(0,5).join(' | ') : ''}`);

await browser.close();
server.close();
console.log(fail === 0 ? '\n全部通过 ✅\n' : `\n${fail} 项失败 ❌\n`);
process.exit(fail === 0 ? 0 : 1);
