/**
 * 用 headless 浏览器渲染美术预览，输出 PNG 供人工检查
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'fs';
import { createServer } from 'http';

const characters = readFileSync(new URL('./characters.js', import.meta.url), 'utf8')
  .replace(/export /g, '');

const html = `<!doctype html><html><body style="margin:0;background:#eee">
<canvas id="c" width="1200" height="720"></canvas>
<script>
${characters}
const kinds = ['dog','cat','rabbit','penguin','panda','chick'];
const pals = ['meadow','sunny','blossom','polar','bamboo','dawn'];
const cv = document.getElementById('c'), ctx = cv.getContext('2d');
kinds.forEach((k,i)=>{
  const col = i%3, row = (i/3)|0;
  ctx.save();
  ctx.translate(col*400, row*360);
  drawScene(ctx, 400, 360, k, pals[i]);
  ctx.restore();
});
</script></body></html>`;

writeFileSync('/tmp/puzzle-preview.html', html);

const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(html);
});
await new Promise((r) => server.listen(8899, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 720 } });
await page.goto('http://localhost:8899/');
await page.waitForTimeout(600);
await page.screenshot({ path: '/tmp/puzzle-preview.png' });
await browser.close();
server.close();
console.log('saved /tmp/puzzle-preview.png');
