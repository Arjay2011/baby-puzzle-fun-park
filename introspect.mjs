/**
 * 浏览器内取证：打开真实游戏，抽取布局几何 + 每个拼块贴图的实际像素统计
 */
import { chromium } from '/Users/zenghuanjia/.workbuddy/binaries/node/workspace/node_modules/playwright/index.mjs';
import { writeFileSync } from 'fs';

const FILE = 'file:///Users/zenghuanjia/WorkBuddy/2026-11-11-10-31-19/拼图乐园.html';
const browser = await chromium.launch({ channel: 'chrome' });

async function grab(vw, vh, dsf, levelIdx, tag) {
  const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: dsf });
  await page.goto(FILE);
  await page.waitForTimeout(900);
  if (levelIdx === null) {
    // 菜单
    const menu = await page.evaluate(() => {
      const r = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
      const cards = [...document.querySelectorAll('#levelList .levelCard')].map((c) => ({
        box: r(c),
        name: c.querySelector('.lvName').textContent,
        stars: c.querySelector('.lvStars').textContent,
        thumbBox: r(c.querySelector('.thumb')),
        thumbPixelStats: (() => {
          const cv = c.querySelector('.thumb');
          const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
          const set = new Set(); let satSum = 0, n = 0;
          for (let i = 0; i < d.length; i += 4) {
            set.add((d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4));
            const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
            satSum += mx ? (mx - mn) / mx : 0; n++;
          }
          return { uniqueColors: set.size, avgSat: +(satSum / n).toFixed(3) };
        })(),
      }));
      const st = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const cs = getComputedStyle(el); const b = el.getBoundingClientRect();
        return { text: el.textContent.trim(), fontSize: cs.fontSize, fontWeight: cs.fontWeight,
                 color: cs.color, bg: cs.backgroundColor, box: { x: b.x, y: b.y, w: b.width, h: b.height } };
      };
      return {
        cards,
        h1: st('.panel h1'), sub: st('.sub'), bigBtn: st('#startBtn'),
        panelBox: r(document.querySelector('#menu')),
        levelListBox: r(document.querySelector('#levelList')),
        docScrollH: document.documentElement.scrollHeight,
        innerH: window.innerHeight,
      };
    });
    return { tag, menu };
  }

  if (levelIdx >= 0) await page.locator('#levelList .levelCard').nth(levelIdx).click();
  else await page.locator('#startBtn').click();
  await page.waitForTimeout(1100);

  const data = await page.evaluate(() => {
    const canvas = document.querySelector('#game');
    const stage = document.querySelector('#stage');
    const sb = stage.getBoundingClientRect();
    const cb = canvas.getBoundingClientRect();
    const L = window.__layout();
    const pieces = window.__pieces().map((p) => {
      const bmp = p.bitmap;
      const ctx = bmp.getContext('2d');
      const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
      const d = img.data, W = bmp.width, H = bmp.height;
      const cx = W / 2, cy = H / 2, cell = L.cell;
      // 轮廓在贴图中的像素坐标
      const polyPx = p.poly.map((pt) => [cx + pt[0] * cell, cy + pt[1] * cell]);
      // 内部/边界判定：到多边形边的距离
      const edgeDist = (x, y) => {
        let m = 1e9;
        for (let i = 0, j = polyPx.length - 1; i < polyPx.length; j = i++) {
          const [ax, ay] = polyPx[j], [bx, by] = polyPx[i];
          const dx = bx - ax, dy = by - ay;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
          m = Math.min(m, Math.hypot(x - (ax + dx * t), y - (ay + dy * t)));
        }
        return m;
      };
      const inside = (x, y) => {
        let c = false;
        for (let i = 0, j = polyPx.length - 1; i < polyPx.length; j = i++) {
          const [xi, yi] = polyPx[i], [xj, yj] = polyPx[j];
          if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
        }
        return c;
      };
      let inN = 0, inR = 0, inG = 0, inB = 0, inL = 0, inL2 = 0, satN = 0, satSum = 0;
      let whiteN = 0, darkN = 0, uniq = new Set();
      let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      for (let y = 0; y < H; y += 1) {
        for (let x = 0; x < W; x += 1) {
          const i = (y * W + x) * 4;
          const r = d[i], g = d[i + 1], b = d[i + 2];
          const Lm = 0.299 * r + 0.587 * g + 0.114 * b;
          const ed = edgeDist(x, y);
          if (!inside(x, y)) continue;
          inN++;
          inR += r; inG += g; inB += b; inL += Lm; inL2 += Lm * Lm;
          const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
          const s = mx ? (mx - mn) / mx : 0; satSum += s; satN++;
          if (Lm > 244) whiteN++;
          if (Lm < 70) darkN++;
          uniq.add((r >> 4) + ',' + (g >> 4) + ',' + (b >> 4));
          if (ed < 6) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
        }
      }
      const mean = inN ? [inR / inN, inG / inN, inB / inN].map((v) => Math.round(v)) : [0, 0, 0];
      const std = inN ? Math.sqrt(Math.max(0, inL2 / inN - (inL / inN) ** 2)) : 0;
      // 描边环（距边 1-6px）的白色占比
      let ringN = 0, ringWhite = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const ed = edgeDist(x, y);
        if (ed > 0.5 && ed < 6 && inside(x, y)) {
          const i = (y * W + x) * 4;
          const Lm = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          ringN++; if (Lm > 236) ringWhite++;
        }
      }
      return {
        id: p.id, cells: p.cells, wCells: p.wCells, hCells: p.hCells,
        trayPos: { x: Math.round(p.pos.x), y: Math.round(p.pos.y) },
        home: { x: Math.round(p.home.x), y: Math.round(p.home.y) },
        angleDeg: +(p.angle * 180 / Math.PI).toFixed(1),
        polyPtCount: p.poly.length,
        art: {
          coveredPx: inN,
          meanRGB: mean,
          lumStd: +std.toFixed(1),
          uniqueColors: uniq.size,
          avgSat: +(satSum / (satN || 1)).toFixed(3),
          whitePct: +(whiteN / (inN || 1) * 100).toFixed(1),
          darkPct: +(darkN / (inN || 1) * 100).toFixed(2),
          strokeWhitePct: +(ringWhite / (ringN || 1) * 100).toFixed(1),
          bboxInBitmap: [minX, minY, maxX, maxY],
        },
      };
    });
    // 托盘两两重叠检测（用真实多边形）
    const polys = window.__pieces().map((p) => {
      const cell = L.cell;
      return { id: p.id, pts: p.poly.map((pt) => [p.pos.x + pt[0] * cell, p.pos.y + pt[1] * cell]) };
    });
    const overlaps = [];
    for (let i = 0; i < polys.length; i++) for (let j = i + 1; j < polys.length; j++) {
      const a = polys[i].pts, b = polys[j].pts;
      let hit = false;
      for (const p of a) if (window.__inPoly(p[0], p[1], b)) { hit = true; break; }
      if (!hit) for (const p of b) if (window.__inPoly(p[0], p[1], a)) { hit = true; break; }
      if (hit) overlaps.push([polys[i].id, polys[j].id]);
    }
    // 出界检测
    const outOfCanvas = [];
    for (const p of polys) {
      const xs = p.pts.map((q) => q[0]), ys = p.pts.map((q) => q[1]);
      const bb = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      if (bb[0] < 0 || bb[1] < 0 || bb[2] > L.W || bb[3] > L.H)
        outOfCanvas.push({ id: p.id, bbox: bb.map((v) => Math.round(v)) });
    }
    // DOM 文本样式
    const st = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el); const b = el.getBoundingClientRect();
      return { text: el.textContent.trim().slice(0, 40), fontSize: cs.fontSize, fontWeight: cs.fontWeight, color: cs.color, bg: cs.backgroundColor, h: Math.round(b.height), w: Math.round(b.width) };
    };
    const hud = document.querySelector('#hud');
    return {
      stage: { x: sb.x, y: sb.y, w: sb.width, h: sb.height },
      canvas: { x: cb.x, y: cb.y, w: cb.width, h: cb.height, dpr: window.devicePixelRatio },
      layout: { W: L.W, H: L.H, cell: L.cell, boardX: L.boardX, boardY: L.boardY, boardW: L.boardW, boardH: L.boardH, trayTop: L.trayTop, trayH: L.trayH },
      pieces, overlaps, outOfCanvas,
      hud: { height: Math.round(hud.getBoundingClientRect().height), levelName: st('#levelName'), starCount: st('#starCount'), attempt: st('#attemptCount'), menuBtn: st('#menuBtn'), refBtn: st('#refBtn'), soundBtn: st('#soundBtn') },
      innerH: window.innerHeight, innerW: window.innerWidth,
      scrollH: document.documentElement.scrollHeight,
    };
  });
  await page.close();
  return { tag, ...data };
}

const out = {};
out.menu = await grab(900, 780, 1, null, 'menu');
out.l1 = await grab(900, 780, 1, 0, 'level1');
out.l6 = await grab(900, 780, 1, 5, 'level6');
out.mobile = await grab(390, 844, 2, 0, 'mobile');

// 通关结算面板
{
  const page = await browser.newPage({ viewport: { width: 900, height: 780 } });
  await page.goto(FILE); await page.waitForTimeout(900);
  await page.locator('#startBtn').click(); await page.waitForTimeout(900);
  for (let i = 0; i < 6; i++) {
    const info = await page.evaluate(() => { const p = window.__debug().find((q) => !q.placed); return p ? { x: p.x, y: p.y, hx: p.home.x, hy: p.home.y } : null; });
    if (!info) break;
    await page.mouse.move(info.x, info.y); await page.mouse.down();
    await page.mouse.move(info.hx, info.hy, { steps: 18 }); await page.mouse.up();
    await page.waitForTimeout(280);
  }
  await page.waitForTimeout(1600);
  out.complete = await page.evaluate(() => {
    const st = (sel) => { const el = document.querySelector(sel); if (!el) return null; const cs = getComputedStyle(el); const b = el.getBoundingClientRect();
      return { text: el.textContent.trim().slice(0, 30), fontSize: cs.fontSize, color: cs.color, w: Math.round(b.width), h: Math.round(b.height), x: Math.round(b.x), y: Math.round(b.y) }; };
    const stars = [...document.querySelectorAll('.wstar')].map((s) => { const cs = getComputedStyle(s); const b = s.getBoundingClientRect();
      return { color: cs.color, opacity: cs.opacity, size: Math.round(b.width), x: Math.round(b.x), y: Math.round(b.y) }; });
    const btns = [...document.querySelectorAll('#complete .bigBtn')].map((b) => { const r = b.getBoundingClientRect(); return { text: b.textContent.trim(), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; });
    const r = document.querySelector('#complete').getBoundingClientRect();
    return { title: st('#winTitle'), stars, btns, panel: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, innerH: window.innerHeight };
  });
  await page.close();
}

writeFileSync('/Users/zenghuanjia/WorkBuddy/2026-11-11-10-31-19/introspect.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2).slice(0, 12000));
await browser.close();
