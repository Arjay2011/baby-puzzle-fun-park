/**
 * 美术回归测试 v2：基于精确 alpha 遮罩测量，不靠颜色猜测
 * 运行：node test-art.mjs
 */
import { chromium } from '/Users/zenghuanjia/.workbuddy/binaries/node/workspace/node_modules/playwright/index.mjs';
import { readFileSync } from 'fs';

const chars = readFileSync(new URL('./characters.js', import.meta.url), 'utf8').replace(/export /g, '');

const html = `<!doctype html><html><body style="margin:0">
<script>
${chars}
/** 用与 drawScene 完全相同的位置渲染角色到透明画布，得到精确遮罩 */
window.mask = function(kind, pal, W, H){
  const { unit, ground, x } = characterLayout(W, H);
  const img = withOutline(renderCharacterCanvas(kind), OUTLINE[kind] || '#5A4034');
  const c = document.createElement('canvas'); c.width=W; c.height=H;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, x, ground - DESIGN.base*unit, DESIGN.w*unit, (DESIGN.bottom-DESIGN.top)*unit);
  const d = ctx.getImageData(0,0,W,H).data;
  const m = new Uint8Array(W*H);
  for(let i=0;i<W*H;i++) m[i] = d[i*4+3] > 40 ? 1 : 0;
  return {mask:m, unit, ground, x};
};
window.scene = function(kind,pal,W,H){
  const c=document.createElement('canvas'); c.width=W;c.height=H;
  drawScene(c.getContext('2d'),W,H,kind,pal);
  return c.getContext('2d').getImageData(0,0,W,H).data;
};
</script></body></html>`;

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[error]', e.message));
await page.setContent(html);

let fail = 0;
const ok = (c, m) => { console.log(`${c ? '  ✅' : '  ❌'} ${m}`); if (!c) fail++; };

const CASES = [
  ['dog', 'meadow'], ['cat', 'sunny'], ['rabbit', 'lilac'],
  ['penguin', 'polar'], ['panda', 'bamboo'], ['chick', 'aqua'],
];
const W = 400, H = 360;

const results = {};
for (const [k, p] of CASES) {
  results[k] = await page.evaluate(([k, p, W, H]) => {
    const { mask, unit, ground } = window.mask(k, p, W, H);
    const scene = window.scene(k, p, W, H);
    let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, ink = 0, topInk = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!mask[y * W + x]) continue;
        ink++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (y === 0) topInk++;
      }
    }
    // 真实边缘对比度：遮罩像素中，与非遮罩邻居相邻的那些
    const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
    const ratios = [];
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        if (!mask[y * W + x]) continue;
        const nb = [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy]) => !mask[(y+dy)*W+(x+dx)]);
        if (!nb) continue;
        const i = (y * W + x) * 4;
        const l1 = lum(scene[i], scene[i+1], scene[i+2]);
        let worst = 99;
        // 只与「角色外部」的邻居比较；内部邻居颜色相近会污染测量
        for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const nx = x+dx, ny = y+dy;
          if (mask[ny*W+nx]) continue;
          const j = (ny*W+nx)*4;
          const l2 = lum(scene[j], scene[j+1], scene[j+2]);
          const cr = (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);
          if (cr < worst) worst = cr;
        }
        if (worst < 99) ratios.push(worst);
      }
    }
    ratios.sort((a,b)=>a-b);
    const q = (f) => ratios.length ? ratios[Math.min(ratios.length-1, Math.floor(ratios.length*f))] : 0;
    const lowPct = ratios.length ? ratios.filter(r=>r<1.4).length/ratios.length*100 : 0;
    return { bbox:[minX,minY,maxX,maxY], ink, topInk, unit, ground,
             med:q(0.5), p75:q(0.75), lowPct };
  }, [k, p, W, H]);
}

console.log('\n[1] 顶部裁切（曾：兔耳被削 54px、猫耳尖距顶 1px）');
for (const [k] of CASES) {
  const r = results[k];
  ok(r.topInk === 0 && r.bbox[1] >= 4, `${k}: 顶行角色像素 ${r.topInk}，bbox 上沿 y=${r.bbox[1]}（≥4 即无裁切）`);
}

console.log('\n[2] 接地基线统一（曾：企鹅/小鸡比其他角色低 15-18px）');
const bottoms = CASES.map(([k]) => [k, results[k].bbox[3]]);
const spread = Math.max(...bottoms.map(b=>b[1])) - Math.min(...bottoms.map(b=>b[1]));
ok(spread <= 6, `六角色底部最大偏差 ${spread}px（≤6）: ${bottoms.map(b=>b[0]+'='+b[1]).join(' ')}`);

console.log('\n[3] 轮廓对比度（曾：小鸡 95.5% 边缘低于 1.4，几乎隐形）');
for (const [k] of CASES) {
  const r = results[k];
  ok(r.lowPct < 45, `${k}: 低对比边缘 ${r.lowPct.toFixed(1)}%（<45）  中位 ${r.med.toFixed(2)}  p75 ${r.p75.toFixed(2)}`);
}

console.log('\n[4] 角色完整性与尺寸（不能贴边/溢出，主体不能太小）');
for (const [k] of CASES) {
  const r = results[k];
  const [x0,y0,x1,y1] = r.bbox;
  const bw = x1-x0, bh = y1-y0;
  ok(x0 >= 0 && y0 >= 0 && x1 < W && y1 < H, `${k}: bbox=[${x0},${y0},${x1},${y1}] 在画布内`);
  ok(bw > 100 && bh > 140, `${k}: 主体尺寸 ${bw}×${bh}（>100×140，画面占比合理）`);
}

await browser.close();
console.log(fail === 0 ? '\n全部通过 ✅\n' : `\n${fail} 项失败 ❌\n`);
process.exit(fail === 0 ? 0 : 1);
