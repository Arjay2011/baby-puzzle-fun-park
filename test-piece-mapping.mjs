/**
 * 拼块取样回归测试
 *
 * 曾出现的致命 bug：renderPieceBitmap 用 drawImage 的 5 参形式（整图缩放）
 * 而非裁剪，导致拼块上显示的是放大错位的场景片段——第 1 关的第二块甚至完全没有狗。
 *
 * 本测试的判定标准：拼块贴图的内容，必须与场景图对应位置的像素高度一致。
 * 运行：node test-piece-mapping.mjs
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
await new Promise((r) => server.listen(8903, r));

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 900, height: 780 } });
page.on('pageerror', (e) => console.log('[error]', e.message));
await page.goto('http://localhost:8903/', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);

let fail = 0;
const ok = (c, m) => { console.log(`${c ? '  ✅' : '  ❌'} ${m}`); if (!c) fail++; };

/**
 * 在游戏内部做像素比对：
 * 对每块拼图，读取贴图中心附近像素，与场景图中该块锚点对应位置的像素比较。
 */
const checkLevel = async (idx) => {
  await page.evaluate(() => { document.querySelector('#levelList .levelCard')?.click(); });
  await page.waitForTimeout(200);
  // 直接选关
  await page.evaluate((i) => {
    document.querySelectorAll('#levelList .levelCard')[i].click();
  }, idx);
  await page.waitForTimeout(900);

  return await page.evaluate(() => {
    const g = window.__probe();
    return g;
  });
};

for (let li = 0; li < 6; li++) {
  const r = await checkLevel(li);
  console.log(`\n[第 ${li + 1} 关] ${r.name}`);
  ok(r.pieces.length >= 2, `拼块数 ${r.pieces.length}`);
  for (const p of r.pieces) {
    // 贴图内容与场景对应位置的一致性
    ok(p.matchRatio > 0.75,
      `块${p.id}: 贴图与场景对应位置吻合度 ${(p.matchRatio * 100).toFixed(1)}%（>75%，容忍重采样插值误差）`);
    // 贴图必须有实际图像内容（不是纯色/全透明）
    ok(p.uniqueColors > 12, `块${p.id}: 含 ${p.uniqueColors} 种颜色（>12，说明有真实图像）`);
    ok(p.fillRatio > 0.85, `块${p.id}: 拼块形状内填充率 ${(p.fillRatio * 100).toFixed(1)}%（>85%，形状完整）`);
    // 贴图内容不能是整片天空/草地这种「无特征」区域
    ok(p.featureRatio > 0.02,
      `块${p.id}: 角色特征像素占比 ${(p.featureRatio * 100).toFixed(2)}%（>2%，含角色五官）`);
  }
  // 拼完后的画面必须与参考图一致
  ok(r.assembledMatch > 0.85,
    `拼合完成后与参考图吻合度 ${(r.assembledMatch * 100).toFixed(1)}%（>85%）`);
}

await browser.close();
server.close();
console.log(fail === 0 ? '\n全部通过 ✅\n' : `\n${fail} 项失败 ❌\n`);
process.exit(fail === 0 ? 0 : 1);
