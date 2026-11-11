/**
 * 阶段 A（浏览器取证）：
 *  - 测量 stage/hud 实际几何
 *  - 用注入的 characters.js 渲染 6 个角色的完整场景 + 缩略图，落盘为 PNG
 *  - 读取菜单 / 通关面板的 DOM 样式与位置
 */
import { chromium } from '/Users/zenghuanjia/.workbuddy/binaries/node/workspace/node_modules/playwright/index.mjs';
import { readFileSync, writeFileSync } from 'fs';

const ROOT = '/Users/zenghuanjia/WorkBuddy/2026-11-11-10-31-19/';
const FILE = 'file://' + ROOT + '拼图乐园.html';

// 把 characters.js 去 export 后注入页面全局
const charsSrc = readFileSync(ROOT + 'characters.js', 'utf8')
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+(const|function|let|var|class)\s/gm, '$1 ')
  .replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, '');

const inject = `
${charsSrc}
window.__ART = { drawScene, drawThumb, PALETTES, CHARACTERS, OUTLINE };
`;

const browser = await chromium.launch({ channel: 'chrome' });
const out = {};

// ---------- 菜单（900x780） ----------
{
  const page = await browser.newPage({ viewport: { width: 900, height: 780 } });
  await page.addInitScript(inject);
  await page.goto(FILE);
  await page.waitForTimeout(1000);
  out.menu = await page.evaluate(() => {
    const r = (el) => { const b = el.getBoundingClientRect(); return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1), bottom: +b.bottom.toFixed(1) }; };
    const st = (sel) => { const el = document.querySelector(sel); if (!el) return null; const cs = getComputedStyle(el); const b = el.getBoundingClientRect();
      return { text: el.textContent.trim().slice(0, 60), fontSize: cs.fontSize, fontWeight: cs.fontWeight, color: cs.color, bg: cs.backgroundColor, lineHeight: cs.lineHeight, box: { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) } }; };
    const cards = [...document.querySelectorAll('#levelList .levelCard')].map((c) => ({
      box: r(c), name: c.querySelector('.lvName').textContent, stars: c.querySelector('.lvStars').textContent,
      thumbBox: r(c.querySelector('.thumb')),
    }));
    return {
      panel: r(document.querySelector('#menu')), levelList: r(document.querySelector('#levelList')),
      h1: st('.panel h1'), sub: st('.sub'), startBtn: st('#startBtn'),
      lvName: st('.lvName'), lvStars: st('.lvStars'),
      cards, docScrollH: document.documentElement.scrollHeight, innerH: window.innerHeight,
      hudHidden: document.querySelector('#hud').classList.contains('hidden'),
    };
  });
  await page.close();
}

// ---------- 游玩态几何（桌面 900x780 与 手机 390x844） ----------
async function playGeom(vw, vh, dsf, tag) {
  const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: dsf });
  await page.addInitScript(inject);
  await page.goto(FILE);
  await page.waitForTimeout(900);
  await page.locator('#startBtn').click();
  await page.waitForTimeout(1000);
  const g = await page.evaluate(() => {
    const stage = document.querySelector('#stage').getBoundingClientRect();
    const hud = document.querySelector('#hud').getBoundingClientRect();
    const cv = document.querySelector('#game');
    const cbb = cv.getBoundingClientRect();
    return {
      stage: { x: stage.x, y: stage.y, w: stage.width, h: stage.height },
      hud: { x: hud.x, y: hud.y, w: hud.width, h: hud.height },
      canvas: { x: cbb.x, y: cbb.y, w: cbb.width, h: cbb.height },
      dpr: window.devicePixelRatio, innerW: innerWidth, innerH: innerHeight,
      scrollH: document.documentElement.scrollHeight,
      hudText: {
        levelName: document.querySelector('#levelName').textContent,
        attempt: document.querySelector('#attemptCount').textContent,
        stars: document.querySelector('#starCount').textContent,
      },
    };
  });
  await page.close();
  return { tag, ...g };
}
out.play_desktop = await playGeom(900, 780, 1, 'desktop');
out.play_mobile = await playGeom(390, 844, 2, 'mobile');

// ---------- 通关结算面板 ----------
{
  const page = await browser.newPage({ viewport: { width: 900, height: 780 } });
  await page.addInitScript(inject);
  await page.goto(FILE); await page.waitForTimeout(900);
  await page.locator('#startBtn').click(); await page.waitForTimeout(900);
  for (let i = 0; i < 8; i++) {
    const info = await page.evaluate(() => { const p = window.__debug().find((q) => !q.placed); return p ? { x: p.x, y: p.y, hx: p.home.x, hy: p.home.y } : null; });
    if (!info) break;
    await page.mouse.move(info.x, info.y); await page.mouse.down();
    await page.mouse.move(info.hx, info.hy, { steps: 20 }); await page.mouse.up();
    await page.waitForTimeout(260);
  }
  await page.waitForTimeout(1700);
  out.complete = await page.evaluate(() => {
    const st = (sel) => { const el = document.querySelector(sel); if (!el) return null; const cs = getComputedStyle(el); const b = el.getBoundingClientRect();
      return { text: el.textContent.trim().slice(0, 30), fontSize: cs.fontSize, color: cs.color, opacity: cs.opacity, transform: cs.transform, box: { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) } }; };
    return {
      title: st('#winTitle'),
      stars: [...document.querySelectorAll('.wstar')].map((s) => { const cs = getComputedStyle(s); const b = s.getBoundingClientRect();
        return { color: cs.color, opacity: cs.opacity, transform: cs.transform, w: +b.width.toFixed(1), h: +b.height.toFixed(1), x: +b.x.toFixed(1), y: +b.y.toFixed(1) }; }),
      btns: [...document.querySelectorAll('#complete .bigBtn')].map((b) => { const r = b.getBoundingClientRect(); const cs = getComputedStyle(b);
        return { text: b.textContent.trim(), fontSize: cs.fontSize, x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; }),
      panel: st('#complete'),
      winStarsBox: st('#winStars'),
    };
  });
  await page.close();
}

// ---------- 渲染 6 个角色场景 + 缩略图 ----------
{
  const page = await browser.newPage({ viewport: { width: 400, height: 400 } });
  await page.addInitScript(inject);
  await page.goto(FILE); await page.waitForTimeout(600);
  const arts = await page.evaluate(() => {
    const levels = [
      { kind: 'dog', pal: 'meadow', cols: 2, rows: 1 },
      { kind: 'cat', pal: 'sunny', cols: 1, rows: 2 },
      { kind: 'rabbit', pal: 'lilac', cols: 2, rows: 2 },
      { kind: 'penguin', pal: 'polar', cols: 2, rows: 2 },
      { kind: 'panda', pal: 'bamboo', cols: 2, rows: 2 },
      { kind: 'chick', pal: 'aqua', cols: 3, rows: 2 },
    ];
    const res = {};
    for (const lv of levels) {
      const w = 512, h = Math.round(512 * (lv.rows / lv.cols));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      window.__ART.drawScene(c.getContext('2d'), w, h, lv.kind, lv.pal);
      res[lv.kind + '_scene'] = c.toDataURL('image/png');
      const t = document.createElement('canvas'); t.width = 120; t.height = 120;
      window.__ART.drawThumb(t.getContext('2d'), 120, 120, lv.kind, lv.pal);
      res[lv.kind + '_thumb'] = t.toDataURL('image/png');
    }
    return res;
  });
  for (const [k, v] of Object.entries(arts)) {
    writeFileSync(ROOT + 'art-' + k + '.png', Buffer.from(v.split(',')[1], 'base64'));
  }
  await page.close();
}

writeFileSync(ROOT + 'probe.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
