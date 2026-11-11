/**
 * 截图实际游戏画面，供人工检查
 * 运行：node shoot.mjs
 */
import { chromium } from '/Users/zenghuanjia/.workbuddy/binaries/node/workspace/node_modules/playwright/index.mjs';

const FILE = 'file:///Users/zenghuanjia/WorkBuddy/2026-11-11-10-31-19/拼图乐园.html';
const OUT = '/Users/zenghuanjia/WorkBuddy/2026-11-11-10-31-19/shots';

const browser = await chromium.launch({ channel: 'chrome' });

/* 1. 菜单 */
{
  const page = await browser.newPage({ viewport: { width: 900, height: 780 } });
  await page.goto(FILE);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}-1-menu.png` });
  await page.close();
}

/* 2. 第 1 关（2 片，最简单） */
{
  const page = await browser.newPage({ viewport: { width: 900, height: 780 } });
  await page.goto(FILE);
  await page.waitForTimeout(800);
  await page.locator('#startBtn').click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}-2-level1.png` });
  await page.close();
}

/* 3. 第 6 关（4 片，L 形，最复杂） */
{
  const page = await browser.newPage({ viewport: { width: 900, height: 780 } });
  await page.goto(FILE);
  await page.waitForTimeout(800);
  await page.locator('#levelList .levelCard').nth(5).click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}-3-level6.png` });
  await page.close();
}

/* 4. 通关结算 */
{
  const page = await browser.newPage({ viewport: { width: 900, height: 780 } });
  await page.goto(FILE);
  await page.waitForTimeout(800);
  await page.locator('#startBtn').click();
  await page.waitForTimeout(900);
  for (let i = 0; i < 6; i++) {
    const info = await page.evaluate(() => {
      const p = window.__debug().find((q) => !q.placed);
      return p ? { x: p.x, y: p.y, hx: p.home.x, hy: p.home.y } : null;
    });
    if (!info) break;
    await page.mouse.move(info.x, info.y);
    await page.mouse.down();
    await page.mouse.move(info.hx, info.hy, { steps: 18 });
    await page.mouse.up();
    await page.waitForTimeout(280);
  }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}-4-complete.png` });
  await page.close();
}

/* 5. 手机竖屏 */
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.goto(FILE);
  await page.waitForTimeout(800);
  await page.locator('#startBtn').click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}-5-mobile.png` });
  await page.close();
}

await browser.close();
console.log('截图完成');
