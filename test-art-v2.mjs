/**
 * 美术复检：针对上一轮视觉检查发现的 8 个问题建立断言
 * 运行：node test-art-v2.mjs
 */
import { chromium } from '/Users/zenghuanjia/.workbuddy/binaries/node/workspace/node_modules/playwright/index.mjs';
import { readFileSync } from 'fs';

const chars = readFileSync(new URL('./characters.js', import.meta.url), 'utf8').replace(/export /g, '');

const html = `<!doctype html><html><body style="margin:0">
<script>
${chars}
/** 渲染角色到透明画布，得到精确 alpha 遮罩 + 颜色 */
window.probe = function(kind, W, H){
  const { unit, ground, x } = characterLayout(W, H);
  const img = withOutline(renderCharacterCanvas(kind), OUTLINE[kind] || '#5A4034');
  const c = document.createElement('canvas'); c.width=W; c.height=H;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, x, ground - (DESIGN.base-DESIGN.top)*unit, DESIGN.w*unit, (DESIGN.bottom-DESIGN.top)*unit);
  const d = ctx.getImageData(0,0,W,H).data;
  const mask = new Uint8Array(W*H);
  for(let i=0;i<W*H;i++) mask[i] = d[i*4+3] > 40 ? 1 : 0;
  return { mask, d, unit, ground, x };
};
/** 在指定设计坐标处取像素颜色（用于验证部件可见性） */
window.at = function(kind, dx, dy, W, H){
  const { unit, ground, x } = characterLayout(W, H);
  const px = Math.round(x + dx*unit), py = Math.round(ground - (DESIGN.base - dy)*unit);
  if(px<0||py<0||px>=W||py>=H) return null;
  const img = withOutline(renderCharacterCanvas(kind), OUTLINE[kind] || '#5A4034');
  const c=document.createElement('canvas'); c.width=W;c.height=H;
  const cx=c.getContext('2d');
  cx.drawImage(img, x, ground - (DESIGN.base-DESIGN.top)*unit, DESIGN.w*unit, (DESIGN.bottom-DESIGN.top)*unit);
  const p = cx.getImageData(px,py,1,1).data;
  return [p[0],p[1],p[2],p[3]];
};
/** 统计某色相区间在遮罩内的占比 */
window.colorShare = function(kind, test, W, H){
  const { mask, d } = window.probe(kind, W, H);
  let hit=0, tot=0;
  for(let i=0;i<W*H;i++){
    if(!mask[i]) continue; tot++;
    const r=d[i*4],g=d[i*4+1],b=d[i*4+2];
    if(test(r,g,b)) hit++;
  }
  return tot? hit/tot : 0;
};
</script></body></html>`;

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[error]', e.message));
await page.setContent(html);

let fail = 0;
const ok = (c, m) => { console.log(`${c ? '  ✅' : '  ❌'} ${m}`); if (!c) fail++; };
const W = 400, H = 360;
const near = (px, r, g, b, tol = 26) =>
  px && Math.abs(px[0] - r) < tol && Math.abs(px[1] - g) < tol && Math.abs(px[2] - b) < tol;

console.log('\n[问题1] 兔子长耳曾被削掉 54px');
{
  const r = await page.evaluate(([W,H]) => {
    const { mask } = window.probe('rabbit', W, H);
    let topInk = 0, minY = 1e9;
    for (let y=0;y<H;y++) for (let x=0;x<W;x++) if (mask[y*W+x]) { if(y===0) topInk++; if(y<minY) minY=y; }
    return { topInk, minY };
  }, [W,H]);
  ok(r.topInk === 0, `兔耳无平切裁切（顶行像素 ${r.topInk}，上沿 y=${r.minY}）`);
}

console.log('\n[问题2] 小鸡呆毛曾被盖住 95%');
{
  // 呆毛在设计坐标 y≈14-58，x≈84-112；头部圆心(100,90) rx47 ry43 → 头顶 y=47
  const px = await page.evaluate(([W,H]) => window.at('chick', 104, 26, W, H), [W,H]);
  ok(near(px, 247, 194, 63, 34), `呆毛顶端可见（采样色 rgb(${px}) 应为呆毛的橙黄 #F7C23F 附近）`);
  const px2 = await page.evaluate(([W,H]) => window.at('chick', 100, 44, W, H), [W,H]);
  ok(near(px2, 255, 221, 110, 30) || near(px2, 247, 194, 63, 40), `呆毛根部与头部衔接自然（rgb(${px2})）`);
}

console.log('\n[问题3] 小鸡/兔子曾几乎隐形');
{
  const share = await page.evaluate(([W,H]) => window.colorShare('chick',
    (r,g,b) => r>230 && g>180 && g<235 && b<130, W, H), [W,H]);
  ok(share > 0.04, `小鸡黄色身体占遮罩 ${(share*100).toFixed(1)}%（>4%，说明确实画出来了）`);
  const share2 = await page.evaluate(([W,H]) => window.colorShare('rabbit',
    (r,g,b) => r>225 && g>205 && b>185 && b<225, W, H), [W,H]);
  ok(share2 > 0.03, `兔子奶白身体占遮罩 ${(share2*100).toFixed(1)}%（>3%）`);
}

console.log('\n[问题4] 狗/猫/熊猫后腿曾被挡 60%+，看不到脚');
{
  // 后腿底部在设计 y=190，主体 blob 底约 y=178 → y=186 处应只有腿色
  for (const [kind, legColor] of [['dog',[201,138,75]], ['cat',[229,138,60]], ['panda',[58,58,58]]]) {
    const px = await page.evaluate(([kind,W,H]) => window.at(kind, kind==='panda'?72:72, 186, W, H), [kind,W,H]);
    ok(near(px, ...legColor, 34), `${kind}: 脚部可见（y=186 采样 rgb(${px}) 应接近腿色 ${legColor}）`);
  }
}

console.log('\n[问题5] 兔子门牙曾白对白看不见');
{
  const px = await page.evaluate(([W,H]) => window.at('rabbit', 96, 122, W, H), [W,H]);
  ok(px && px[0] > 240 && px[1] > 240 && px[2] > 240, `门牙为亮白 rgb(${px})`);
  const px2 = await page.evaluate(([W,H]) => window.at('rabbit', 100, 112, W, H), [W,H]);
  ok(px2 && !(px2[0] > 240 && px2[1] > 240 && px2[2] > 240), `口鼻区非纯白 rgb(${px2})（与门牙有区分）`);
}

console.log('\n[问题6] 猫耳曾与头部同色、边界消失');
{
  const ear = await page.evaluate(([W,H]) => window.at('cat', 68, 30, W, H), [W,H]);
  const head = await page.evaluate(([W,H]) => window.at('cat', 100, 60, W, H), [W,H]);
  const diff = ear && head ? Math.abs(ear[0]-head[0]) + Math.abs(ear[1]-head[1]) + Math.abs(ear[2]-head[2]) : 0;
  ok(diff > 30, `猫耳 rgb(${ear}) 与头部 rgb(${head}) 色差 ${diff}（>30，边界可辨）`);
}

console.log('\n[问题7] 脚部基线曾不齐（差 15-18px）');
{
  const bots = await page.evaluate(([W,H]) => {
    const kinds=['dog','cat','rabbit','penguin','panda','chick'];
    return kinds.map(k => { const {mask}=window.probe(k,W,H); let mx=-1;
      for(let y=0;y<H;y++)for(let x=0;x<W;x++) if(mask[y*W+x]&&y>mx) mx=y; return mx; });
  }, [W,H]);
  const spread = Math.max(...bots) - Math.min(...bots);
  ok(spread <= 4, `六角色底部偏差 ${spread}px（≤4）: ${bots.join(',')}`);
}

console.log('\n[问题8] 眼睛曾变成「白心空心圈」');
{
  for (const [kind, dx, dy] of [['dog',82,74], ['cat',81,80], ['rabbit',82,86], ['penguin',83,68], ['chick',84,86]]) {
    const px = await page.evaluate(([kind,dx,dy,W,H]) => window.at(kind,dx,dy,W,H), [kind,dx,dy,W,H]);
    // 眼睛中心应为深色（瞳孔/虹膜），不是白色
    const isWhite = px && px[0] > 215 && px[1] > 215 && px[2] > 215;
    ok(!isWhite, `${kind}: 眼中心为深色 rgb(${px})（非白色空心）`);
  }
}

await browser.close();
console.log(fail === 0 ? '\n全部通过 ✅\n' : `\n${fail} 项失败 ❌\n`);
process.exit(fail === 0 ? 0 : 1);
