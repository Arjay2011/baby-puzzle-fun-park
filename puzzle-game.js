/**
 * 拼图游戏主体
 * 依赖：puzzle-parts.js（几何）、characters.js（美术）、audio.js（音效语音）
 */

import { LEVELS, buildLevel, pointInPoly, computeLayout, lerp, clamp } from './puzzle-parts.js';
import { drawScene, drawThumb, characterLayout, DESIGN } from './characters.js';
import { Audio2 } from './audio.js';

/* ==================== CONFIG ==================== */
const CONFIG = {
  STEP: 1 / 60,
  SNAP_RATIO: 0.42,        // 吸附判定：与目标距离小于目标格尺寸的比例
  GRAB_RADIUS: 46,         // 手指抓取判定半径（像素）
  LIFT_SCALE: 1.07,        // 拿起时放大
  LIFT_SHADOW: 22,         // 拿起时阴影
  REST_SHADOW: 8,          // 平放时阴影
  MAX_DPR: 2,
  STAR_THRESHOLDS: [3, 6], // 尝试次数阈值：≤3 星，≤6 两星，更少一星
  SAVE_KEY: 'puzzle_kids_progress_v1',
  SOUND_KEY: 'puzzle_kids_sound_v1',
};
/* ================================================ */

const $ = (s) => document.querySelector(s);
const canvas = $('#game');
const ctx = canvas.getContext('2d');

let W = 0, H = 0, dpr = 1;

/* ---------------- 关卡与运行时状态 ---------------- */

const State = {
  MENU: 'menu',
  PLAY: 'play',
  COMPLETE: 'complete',
};

let state = State.MENU;
let levelIndex = 0;
let level = null;
let pieces = [];
let layout = null;
let boardCanvas = null;      // 关卡完整画面（离屏）
let sceneCanvas = null;      // 场景参考图（离屏）
let placedCount = 0;
let attempts = 0;
let dragging = null;         // {piece, dx, dy}
let stars = loadProgress();
let soundOn = loadSound();

const particles = [];
const confetti = [];

function loadProgress() {
  try {
    const raw = localStorage.getItem(CONFIG.SAVE_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return Array.isArray(obj) ? obj : [];
  } catch (e) { return []; }
}
function saveProgress() {
  try { localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(stars)); } catch (e) { /* ignore */ }
}
function loadSound() {
  try { return localStorage.getItem(CONFIG.SOUND_KEY) !== '0'; } catch (e) { return true; }
}
function saveSound() {
  try { localStorage.setItem(CONFIG.SOUND_KEY, soundOn ? '1' : '0'); } catch (e) { /* ignore */ }
}

/* ---------------- 关卡加载 ---------------- */

function loadLevel(idx) {
  levelIndex = clamp(idx, 0, LEVELS.length - 1);
  level = LEVELS[levelIndex];
  const built = buildLevel(level, level.id);
  pieces = built.pieces;
  placedCount = 0;
  attempts = 0;
  particles.length = 0;
  confetti.length = 0;
  dragging = null;

  // 预渲染关卡画面与场景参考图
  const pw = 512;
  const ph = Math.round(pw * (level.rows / level.cols));
  sceneCanvas = document.createElement('canvas');
  sceneCanvas.width = pw;
  sceneCanvas.height = ph;
  drawScene(sceneCanvas.getContext('2d'), pw, ph, level.kind, level.pal);

  boardCanvas = document.createElement('canvas');
  boardCanvas.width = pw;
  boardCanvas.height = ph;
  const bctx = boardCanvas.getContext('2d');
  bctx.drawImage(sceneCanvas, 0, 0);

  // 为每块生成带阴影的离屏贴图（阴影随拿起状态变化，这里只画本体）
  for (const p of pieces) {
    p.home = { x: p.anchor[0], y: p.anchor[1] };  // 单位坐标
    p.pos = { x: 0, y: 0 };                      // 实际位置（像素）
    p.angle = 0;
    p.placed = false;
    p.pop = 0;          // 吸附时的弹跳动画
    p.glow = 0;         // 靠近目标时的提示高亮
    p.bitmap = null;    // 离屏贴图
  }

  layout = computeLayout(pieces, level.cols, level.rows, W, H, {
    margin: 14, trayGap: 18, maxCell: 168, minCell: 48,
  });

  // 摆放散落的拼块
  for (const s of layout.slots) {
    const p = pieces[s.index];
    p.pos.x = s.x + s.jitterX;
    p.pos.y = s.y + s.jitterY;
    p.angle = s.angle;
    p.home.x = layout.boardX + p.anchor[0] * layout.cell;
    p.home.y = layout.boardY + p.anchor[1] * layout.cell;
    p.bitmap = renderPieceBitmap(p);
  }

  // HUD 已显示，stage 高度可能与初始不同：重排一次并推开重叠的块
  resize();
  separatePieces();

  updateHUD();
  Audio2.voice.say(`第${levelIndex + 1}关，${level.name}，把拼图拼起来吧`);
}

/** 把一块拼图渲染成离屏贴图（含该块在场景中的图像内容） */
function renderPieceBitmap(p) {
  const cell = layout.cell;
  const bmp = document.createElement('canvas');
  bmp.width = Math.ceil(cell * 2.6);
  bmp.height = Math.ceil(cell * 2.6);
  const c = bmp.getContext('2d');
  const cx = bmp.width / 2, cy = bmp.height / 2;

  // 1) 裁剪出这块拼图的外形
  c.save();
  c.beginPath();
  const poly = p.poly;
  poly.forEach((pt, i) => {
    const x = cx + pt[0] * cell, y = cy + pt[1] * cell;
    i === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
  });
  c.closePath();
  c.clip();

  // 2) 把场景画进裁剪区。
  //    用变换矩阵而非 drawImage 的裁剪参数：拼块边缘会略微超出场景边界，
  //    变换方式不会因源矩形越界而缩放变形。
  const cellInScene = sceneCanvas.width / level.cols;  // 场景中 1 格 = 多少像素
  const k = cell / cellInScene;                        // 场景像素 → 贴图像素
  c.translate(cx, cy);
  c.scale(k, k);
  c.translate(-p.anchor[0] * cellInScene, -p.anchor[1] * cellInScene);
  c.drawImage(sceneCanvas, 0, 0);
  c.restore();

  // 2) 描边：沿同一条多边形画一圈浅色边，模拟拼图块的立体感
  c.save();
  c.beginPath();
  poly.forEach((pt, i) => {
    const x = cx + pt[0] * cell, y = cy + pt[1] * cell;
    i === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
  });
  c.closePath();
  c.strokeStyle = 'rgba(255,255,255,0.92)';
  c.lineWidth = Math.max(3, cell * 0.055);
  c.lineJoin = 'round';
  c.stroke();
  c.strokeStyle = 'rgba(120,90,60,0.28)';
  c.lineWidth = Math.max(1.5, cell * 0.02);
  c.stroke();
  c.restore();

  return bmp;
}

/* ---------------- 布局与尺寸 ---------------- */

function resize() {
  const rect = canvas.parentElement.getBoundingClientRect();
  dpr = Math.min(window.devicePixelRatio || 1, CONFIG.MAX_DPR);
  W = Math.max(320, Math.floor(rect.width));
  H = Math.max(320, Math.floor(rect.height));
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (level) {
    layout = computeLayout(pieces, level.cols, level.rows, W, H, {
      margin: 14, trayGap: 18, maxCell: 168, minCell: 48,
    });
    // 重新计算归位坐标；已归位的块直接对齐，未归位的块按比例重新散落
    for (const p of pieces) {
      p.home.x = layout.boardX + p.anchor[0] * layout.cell;
      p.home.y = layout.boardY + p.anchor[1] * layout.cell;
    }
    layout.slots.forEach((s) => {
      const p = pieces[s.index];
      if (!p.placed) {
        p.pos.x = s.x + s.jitterX;
        p.pos.y = s.y + s.jitterY;
        p.angle = s.angle;
      }
      p.bitmap = renderPieceBitmap(p);
    });
    // 散开可能互相重叠的块
    separatePieces();
  }
}

/**
 * 推开互相重叠的拼块，并保证每块都完整落在画布内。
 *
 * 关键：拼块带榫卯且有随机旋转，实际占位比格子大得多（L 形块半宽可达 1 倍 cell），
 * 所以边界约束必须按「旋转后的真实包围盒」算，不能用固定系数。
 */
function separatePieces() {
  const cell = layout.cell;
  const gap = cell * 0.14;
  const free = pieces.filter((p) => !p.placed);
  if (!free.length) return;

  /** 拼块旋转后的轴对齐包围盒（半宽/半高） */
  const extent = (p) => {
    let hw = 0, hh = 0;
    const cos = Math.cos(p.angle), sin = Math.sin(p.angle);
    for (const pt of p.poly) {
      const lx = pt[0] * cell, ly = pt[1] * cell;
      const rx = lx * cos - ly * sin, ry = lx * sin + ly * cos;
      hw = Math.max(hw, Math.abs(rx));
      hh = Math.max(hh, Math.abs(ry));
    }
    return { hw, hh };
  };

  /** 把中心点夹回「整块都在画布内」的范围 */
  const clampInside = (p) => {
    const { hw, hh } = extent(p);
    const minX = Math.max(hw, 0) + 2;
    const maxX = W - hw - 2;
    const minY = Math.max(hh, 0) + 2;
    const maxY = H - hh - 2;
    if (maxX < minX) { p.pos.x = W / 2; } else { p.pos.x = clamp(p.pos.x, minX, maxX); }
    if (maxY < minY) { p.pos.y = H / 2; } else { p.pos.y = clamp(p.pos.y, minY, maxY); }
  };

  const radius = (p) => {
    const { hw, hh } = extent(p);
    return Math.hypot(hw, hh);
  };

  for (let iter = 0; iter < 80; iter++) {
    let moved = false;
    for (let i = 0; i < free.length; i++) {
      for (let j = i + 1; j < free.length; j++) {
        const a = free[i], b = free[j];
        let dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y;
        let dist = Math.hypot(dx, dy);
        const need = radius(a) + radius(b) + gap;
        if (dist >= need) continue;
        if (dist < 0.001) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; dist = 0.01; }
        const push = (need - dist) / 2;
        const ux = dx / dist, uy = dy / dist;
        a.pos.x -= ux * push; a.pos.y -= uy * push;
        b.pos.x += ux * push; b.pos.y += uy * push;
        moved = true;
      }
    }
    for (const p of free) clampInside(p);
    if (!moved) break;
  }
}

/* ---------------- 命中检测 ---------------- */

/** 判断屏幕点是否落在某块拼图上 */
function hitTest(x, y) {
  for (let i = pieces.length - 1; i >= 0; i--) {
    const p = pieces[i];
    if (p.placed) continue;
    // 逆变换到拼块局部坐标
    const dx = x - p.pos.x, dy = y - p.pos.y;
    const cos = Math.cos(-p.angle), sin = Math.sin(-p.angle);
    const lx = dx * cos - dy * sin;
    const ly = dx * sin + dy * cos;
    const inside = pointInPoly(lx / layout.cell, ly / layout.cell, p.poly);
    if (inside) return p;
  }
  // 没命中精确形状时，落在轨迹板上的任意一块都允许抓（对小手指友好）
  for (let i = pieces.length - 1; i >= 0; i--) {
    const p = pieces[i];
    if (p.placed) continue;
    const dx = x - p.pos.x, dy = y - p.pos.y;
    const r = Math.hypot(dx, dy);
    if (r < CONFIG.GRAB_RADIUS + layout.cell * 0.3) return p;
  }
  return null;
}

/* ---------------- 交互 ---------------- */

function onPointerDown(e) {
  if (state !== State.PLAY) return;
  Audio2.unlock();
  const pt = pointerPos(e);
  const p = hitTest(pt.x, pt.y);
  if (!p) return;
  e.preventDefault();
  canvas.setPointerCapture?.(e.pointerId);
  dragging = { piece: p, dx: p.pos.x - pt.x, dy: p.pos.y - pt.y, moved: false };
  Audio2.sfx.pick();
  updateHUD();
}

function onPointerMove(e) {
  if (!dragging) return;
  e.preventDefault();
  const pt = pointerPos(e);
  const p = dragging.piece;
  p.pos.x = pt.x + dragging.dx;
  p.pos.y = pt.y + dragging.dy;
  dragging.moved = true;
  // 靠近目标时给一点磁吸提示（不完全吸附，避免误操作）
  const d = Math.hypot(p.pos.x - p.home.x, p.pos.y - p.home.y);
  p.glow = clamp(1 - d / (layout.cell * 1.2), 0, 1);
}

function onPointerUp(e) {
  if (!dragging) return;
  const p = dragging.piece;
  dragging = null;
  p.glow = 0;

  const cell = layout.cell;
  const d = Math.hypot(p.pos.x - p.home.x, p.pos.y - p.home.y);
  const snapDist = cell * CONFIG.SNAP_RATIO;

  if (d < snapDist) {
    // 吸附归位
    p.placed = true;
    p.pos.x = p.home.x;
    p.pos.y = p.home.y;
    p.angle = 0;
    p.pop = 1;
    placedCount++;
    Audio2.sfx.snap();
    spawnParticles(p.pos.x, p.pos.y, '#FFD24A');
    if (placedCount === pieces.length) {
      setTimeout(() => onLevelComplete(), 620);
    }
  } else {
    // 没对准，回弹到托盘区
    const inTray = p.pos.y > layout.trayTop - layout.cell * 0.3;
    if (!inTray) {
      p.pos.y = Math.min(H - layout.cell * 0.6, p.pos.y);
    }
    Audio2.sfx.drop();
  }
  updateHUD();
}

function pointerPos(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

/* ---------------- 粒子与彩带 ---------------- */

function spawnParticles(x, y, color) {
  for (let i = 0; i < 12; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 60 + Math.random() * 140;
    particles.push({
      x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40,
      life: 0.55, size: 3 + Math.random() * 4, color,
    });
  }
}

function spawnConfetti() {
  const colors = ['#FF6B6B', '#FFD24A', '#4FC08A', '#4FA9E8', '#C470C9', '#FF9F45'];
  for (let i = 0; i < 90; i++) {
    confetti.push({
      x: Math.random() * W,
      y: -20 - Math.random() * H * 0.5,
      vx: (Math.random() - 0.5) * 90,
      vy: 90 + Math.random() * 140,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 9,
      size: 7 + Math.random() * 7,
      color: colors[(Math.random() * colors.length) | 0],
      life: 4,
    });
  }
}

/* ---------------- 关卡完成 ---------------- */

function onLevelComplete() {
  state = State.COMPLETE;
  Audio2.sfx.win();
  Audio2.voice.say(`${level.name}拼好啦，你真棒！`);
  spawnConfetti();

  // 星级：按尝试次数评定
  const n = attempts;
  const starCount = n <= CONFIG.STAR_THRESHOLDS[0] ? 3 : n <= CONFIG.STAR_THRESHOLDS[1] ? 2 : 1;
  const prev = stars[levelIndex] || 0;
  if (starCount > prev) { stars[levelIndex] = starCount; saveProgress(); }

  // 逐颗播报星星音
  for (let i = 0; i < starCount; i++) {
    setTimeout(() => Audio2.sfx.star(i), 260 + i * 260);
  }

  setTimeout(() => {
    showCompletePanel(starCount);
  }, 700);
}

/* ---------------- 渲染 ---------------- */

function render() {
  ctx.clearRect(0, 0, W, H);
  drawBackground();

  if (!level) return;

  // 目标区域：显示淡淡的参考图 + 轮廓
  drawTargetBoard();

  // 拼块
  for (const p of pieces) drawPiece(p);

  // 拖动中的块画在最上层
  if (dragging) drawPiece(dragging.piece, true);

  drawParticles();
  drawConfetti();
}

function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#FFF8EC');
  g.addColorStop(1, '#FFEEDC');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function drawTargetBoard() {
  const { boardX, boardY, boardW, boardH } = layout;

  // 板面阴影
  ctx.save();
  ctx.shadowColor = 'rgba(120, 90, 60, 0.25)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = '#FFFDF8';
  roundRect(ctx, boardX, boardY, boardW, boardH, 16);
  ctx.fill();
  ctx.restore();

  // 参考图：淡淡一层，孩子能看出「要拼成什么样」但不至于直接给答案
  ctx.save();
  ctx.globalAlpha = 0.32;
  roundRect(ctx, boardX, boardY, boardW, boardH, 16);
  ctx.clip();
  ctx.drawImage(sceneCanvas, boardX, boardY, boardW, boardH);
  ctx.restore();

  // 每块的凹槽轮廓
  for (const p of pieces) {
    const isTarget = dragging && dragging.piece === p;
    ctx.save();
    ctx.translate(p.home.x, p.home.y);
    ctx.beginPath();
    p.poly.forEach((pt, i) => {
      const x = pt[0] * layout.cell, y = pt[1] * layout.cell;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.setLineDash([8, 7]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = isTarget ? 'rgba(232,120,40,0.95)' : 'rgba(130,98,68,0.72)';
    ctx.stroke();
    ctx.restore();
  }

  // 目标区域边框
  ctx.save();
  roundRect(ctx, boardX, boardY, boardW, boardH, 16);
  ctx.strokeStyle = 'rgba(190,160,130,0.55)';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.restore();
}

function drawPiece(p, onTop = false) {
  if (!p.bitmap) return;
  const lift = dragging && dragging.piece === p;
  const scale = (lift ? CONFIG.LIFT_SCALE : 1) * (1 + p.pop * 0.12);

  ctx.save();
  ctx.translate(p.pos.x, p.pos.y);
  ctx.rotate(p.angle);
  ctx.scale(scale, scale);

  // 阴影
  ctx.save();
  ctx.shadowColor = 'rgba(90, 60, 35, 0.35)';
  ctx.shadowBlur = lift ? CONFIG.LIFT_SHADOW : CONFIG.REST_SHADOW;
  ctx.shadowOffsetY = lift ? 10 : 3;
  ctx.globalAlpha = 0.9;
  // 用形状做阴影载体
  ctx.beginPath();
  p.poly.forEach((pt, i) => {
    const x = pt[0] * layout.cell, y = pt[1] * layout.cell;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.restore();

  // 贴图
  ctx.drawImage(p.bitmap, -p.bitmap.width / 2, -p.bitmap.height / 2);

  // 靠近目标时的呼吸高亮
  if (p.glow > 0.02) {
    ctx.save();
    ctx.globalAlpha = p.glow * 0.55;
    ctx.beginPath();
    p.poly.forEach((pt, i) => {
      const x = pt[0] * layout.cell, y = pt[1] * layout.cell;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = '#FFD24A';
    ctx.fill();
    ctx.restore();
  }

  ctx.restore();
}

function drawParticles() {
  for (const p of particles) {
    ctx.save();
    ctx.globalAlpha = clamp(p.life / 0.55, 0, 1);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawConfetti() {
  for (const c of confetti) {
    ctx.save();
    ctx.globalAlpha = clamp(c.life, 0, 1);
    ctx.translate(c.x, c.y);
    ctx.rotate(c.rot);
    ctx.fillStyle = c.color;
    ctx.fillRect(-c.size / 2, -c.size / 2, c.size, c.size * 0.62);
    ctx.restore();
  }
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/* ---------------- 更新循环 ---------------- */

function update(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 460 * dt;
    p.life -= dt;
    if (p.life <= 0) particles.splice(i, 1);
  }
  for (let i = confetti.length - 1; i >= 0; i--) {
    const c = confetti[i];
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    c.rot += c.vr * dt;
    c.life -= dt * 0.22;
    if (c.life <= 0 || c.y > H + 40) confetti.splice(i, 1);
  }
  for (const p of pieces) {
    if (p.pop > 0) {
      p.pop = Math.max(0, p.pop - dt * 3.2);
      // 弹跳缓动
      const t = 1 - p.pop;
      p.popScale = Math.sin(t * Math.PI) * 0.12;
    }
  }
}

/* ---------------- UI ---------------- */

function updateHUD() {
  $('#levelName').textContent = level ? `${levelIndex + 1}. ${level.name}` : '拼图乐园';
  const s = stars[levelIndex] || 0;
  const el = $('#starCount');
  if (el) el.textContent = s ? '★'.repeat(s) + '☆'.repeat(3 - s) : '☆☆☆';
  const att = $('#attemptCount');
  if (att && level) att.textContent = `第 ${levelIndex + 1} / ${LEVELS.length} 关 · 已尝试 ${attempts} 次`;
}

function showMenu() {
  state = State.MENU;
  $('#menu').classList.remove('hidden');
  $('#complete').classList.add('hidden');
  $('#hud').classList.add('hidden');
  buildLevelCards();
}

function buildLevelCards() {
  const wrap = $('#levelList');
  wrap.innerHTML = '';
  LEVELS.forEach((lv, i) => {
    const card = document.createElement('button');
    card.className = 'levelCard';
    const c = document.createElement('canvas');
    c.width = 120; c.height = 120;
    c.className = 'thumb';
    drawThumb(c.getContext('2d'), 120, 120, lv.kind, lv.pal);
    const label = document.createElement('div');
    label.className = 'lvName';
    label.textContent = lv.name;
    const st = document.createElement('div');
    st.className = 'lvStars';
    const s = stars[i] || 0;
    st.textContent = s ? '★'.repeat(s) + '☆'.repeat(3 - s) : '☆☆☆';
    card.appendChild(c);
    card.appendChild(label);
    card.appendChild(st);
    card.addEventListener('click', () => {
      Audio2.unlock();
      Audio2.sfx.tap();
      startLevel(i);
    });
    wrap.appendChild(card);
  });
}

function startLevel(i) {
  $('#menu').classList.add('hidden');
  $('#complete').classList.add('hidden');
  $('#hud').classList.remove('hidden');
  state = State.PLAY;
  loadLevel(i);
  Audio2.music.start();
}

function showCompletePanel(starCount) {
  const panel = $('#complete');
  panel.classList.remove('hidden');
  const st = $('#winStars');
  st.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const s = document.createElement('span');
    s.className = 'wstar' + (i < starCount ? ' on' : '');
    s.textContent = '★';
    st.appendChild(s);
  }
  $('#winTitle').textContent = `${level.name} 完成！`;
  const nextBtn = $('#nextBtn');
  if (levelIndex >= LEVELS.length - 1) {
    nextBtn.textContent = '回到关卡表';
  } else {
    nextBtn.textContent = '下一关';
  }
}

function nextLevel() {
  if (levelIndex >= LEVELS.length - 1) {
    showMenu();
  } else {
    startLevel(levelIndex + 1);
  }
}

function showReference() {
  const panel = $('#refModal');
  const c = $('#refCanvas');
  const maxW = Math.min(window.innerWidth * 0.86, 520);
  const ratio = sceneCanvas.height / sceneCanvas.width;
  c.width = Math.round(maxW);
  c.height = Math.round(maxW * ratio);
  const cc = c.getContext('2d');
  cc.fillStyle = '#fff';
  cc.fillRect(0, 0, c.width, c.height);
  cc.drawImage(sceneCanvas, 0, 0, c.width, c.height);
  panel.classList.remove('hidden');
  Audio2.voice.say('这是完整的图片，看看拼块应该放在哪里');
}

/* ---------------- 事件绑定 ---------------- */

function bindEvents() {
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  $('#startBtn').addEventListener('click', () => {
    Audio2.unlock();
    Audio2.sfx.tap();
    startLevel(0);
  });

  $('#menuBtn').addEventListener('click', () => {
    Audio2.sfx.tap();
    showMenu();
  });

  $('#refBtn').addEventListener('click', () => {
    Audio2.sfx.tap();
    if (level) showReference();
  });

  $('#closeRef').addEventListener('click', () => {
    $('#refModal').classList.add('hidden');
    Audio2.sfx.tap();
  });

  $('#nextBtn').addEventListener('click', () => {
    Audio2.sfx.tap();
    nextLevel();
  });

  $('#retryBtn').addEventListener('click', () => {
    Audio2.sfx.tap();
    startLevel(levelIndex);
  });

  $('#menuBtn2').addEventListener('click', () => {
    Audio2.sfx.tap();
    showMenu();
  });

  $('#soundBtn').addEventListener('click', () => {
    soundOn = !soundOn;
    Audio2.setEnabled(soundOn);
    Audio2.setVoiceEnabled(soundOn);
    saveSound();
    $('#soundBtn').textContent = soundOn ? '🔊' : '🔇';
    if (soundOn) { Audio2.unlock(); Audio2.sfx.tap(); Audio2.music.start(); }
  });

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 120));
  // HUD 显隐会改变 stage 高度，用 ResizeObserver 兜住，避免画布溢出被裁切
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => {
      const r = canvas.parentElement.getBoundingClientRect();
      if (Math.abs(r.width - W) > 1 || Math.abs(r.height - H) > 1) resize();
    });
    ro.observe(canvas.parentElement);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) Audio2.music.stop();
    else if (state === State.PLAY || state === State.COMPLETE) Audio2.music.start();
  });
}

/* ---------------- 主循环 ---------------- */

let acc = 0, last = performance.now();
function frame(now) {
  const raw = Math.min((now - last) / 1000, 0.25);
  last = now;
  acc += raw;
  while (acc >= CONFIG.STEP) { update(CONFIG.STEP); acc -= CONFIG.STEP; }
  render();
  requestAnimationFrame(frame);
}

function init() {
  resize();
  bindEvents();
  $('#soundBtn').textContent = soundOn ? '🔊' : '🔇';
  Audio2.setEnabled(soundOn);
  Audio2.setVoiceEnabled(soundOn);
  showMenu();
  requestAnimationFrame(frame);
}

// 调试/测试接口：暴露拼块坐标与状态
window.__debug = () => pieces.map((p) => ({
  id: p.id,
  x: p.pos.x, y: p.pos.y,
  home: { x: p.home.x, y: p.home.y },
  placed: p.placed,
}));

/**
 * 像素探针：验证每块拼图的贴图内容与场景图对应位置是否一致。
 * 用于回归测试 drawImage 的裁剪参数用错导致「贴图内容错位」的问题。
 */
window.__probe = () => {
  const cellInScene = sceneCanvas.width / level.cols;
  const k = layout.cell / cellInScene;
  const sceneData = sceneCanvas.getContext('2d').getImageData(0, 0, sceneCanvas.width, sceneCanvas.height).data;
  const SW = sceneCanvas.width, SH = sceneCanvas.height;

  const list = pieces.map((p) => {
    const bmp = p.bitmap;
    if (!bmp) return { id: p.id, matchRatio: 0, uniqueColors: 0, opaqueRatio: 0, featureRatio: 0 };
    const bctx = bmp.getContext('2d');
    const bd = bctx.getImageData(0, 0, bmp.width, bmp.height).data;

    // 取贴图中落在多边形内的像素，逐个换算回场景坐标比对
    const cx = bmp.width / 2, cy = bmp.height / 2;
    let total = 0, match = 0, opaque = 0;
    const colors = new Set();
    let feature = 0;
    // 形状内应有的像素数（用多边形面积估算），用来算填充完整度
    let polyArea = 0;
    for (let i = 0; i < p.poly.length; i++) {
      const a = p.poly[i], b = p.poly[(i + 1) % p.poly.length];
      polyArea += a[0] * b[1] - b[0] * a[1];
    }
    polyArea = Math.abs(polyArea) / 2 * layout.cell * layout.cell;

    for (let y = 0; y < bmp.height; y += 2) {
      for (let x = 0; x < bmp.width; x += 2) {
        const bi = (y * bmp.width + x) * 4;
        if (bd[bi + 3] < 200) continue;
        opaque++;
        // 贴图像素 → 拼块局部坐标（格）
        const lx = (x - cx) / layout.cell, ly = (y - cy) / layout.cell;
        // 局部坐标 → 场景像素
        const sx = (p.anchor[0] + lx) * cellInScene;
        const sy = (p.anchor[1] + ly) * cellInScene;
        if (sx < 0 || sy < 0 || sx >= SW || sy >= SH) continue;
        const si = ((sy | 0) * SW + (sx | 0)) * 4;
        total++;
        const dr = Math.abs(bd[bi] - sceneData[si]);
        const dg = Math.abs(bd[bi + 1] - sceneData[si + 1]);
        const db = Math.abs(bd[bi + 2] - sceneData[si + 2]);
        if (dr < 26 && dg < 26 && db < 26) match++;
        colors.add((bd[bi] >> 4) + ',' + (bd[bi + 1] >> 4) + ',' + (bd[bi + 2] >> 4));
        // 角色特征：深色（眼睛/鼻子/描边）或高饱和色
        const mx = Math.max(bd[bi], bd[bi + 1], bd[bi + 2]);
        const mn = Math.min(bd[bi], bd[bi + 1], bd[bi + 2]);
        if (mx < 90 || (mx - mn) > 70) feature++;
      }
    }
    const n = Math.max(1, total);
    // 采样步长为 2，面积按 4 倍折算
    const filledArea = opaque * 4;
    return {
      id: p.id,
      matchRatio: total ? match / total : 0,
      uniqueColors: colors.size,
      fillRatio: Math.min(1, filledArea / Math.max(1, polyArea)),
      featureRatio: feature / n,
    };
  });

  // 拼合完成度：把所有块都放到目标位后重绘一帧，与场景图比对
  const saved = pieces.map((p) => ({ p, x: p.pos.x, y: p.pos.y, placed: p.placed }));
  pieces.forEach((p) => { p.pos.x = p.home.x; p.pos.y = p.home.y; p.angle = 0; p.placed = true; });
  render();
  const shot = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let tot = 0, hit = 0;
  for (let y = 0; y < canvas.height; y += 3) {
    for (let x = 0; x < canvas.width; x += 3) {
      // 只比较目标板区域
      const px = x / dpr, py = y / dpr;
      if (px < layout.boardX || px > layout.boardX + layout.boardW) continue;
      if (py < layout.boardY || py > layout.boardY + layout.boardH) continue;
      const sx = Math.floor((px - layout.boardX) / layout.boardW * SW);
      const sy = Math.floor((py - layout.boardY) / layout.boardH * SH);
      if (sx < 0 || sy < 0 || sx >= SW || sy >= SH) continue;
      const si = (sy * SW + sx) * 4;
      const di = (y * canvas.width + x) * 4;
      tot++;
      if (Math.abs(shot[di] - sceneData[si]) < 30 &&
          Math.abs(shot[di + 1] - sceneData[si + 1]) < 30 &&
          Math.abs(shot[di + 2] - sceneData[si + 2]) < 30) hit++;
    }
  }
  // 还原
  saved.forEach((s) => { s.p.pos.x = s.x; s.p.pos.y = s.y; s.p.placed = s.placed; });
  render();

  return { name: level.name, pieces: list, assembledMatch: tot ? hit / tot : 0 };
};

/**
 * 边界探针：检查拼块是否越出画布、互相重叠、压住目标板。
 * 用于回归测试布局约束（曾出现拼块被画布边缘裁切的问题）。
 */
window.__bounds = () => {
  const cell = layout ? layout.cell : 0;
  const boxes = [];
  for (const p of pieces) {
    if (p.placed) continue;
    let hw = 0, hh = 0;
    const cos = Math.cos(p.angle), sin = Math.sin(p.angle);
    for (const pt of p.poly) {
      const lx = pt[0] * cell, ly = pt[1] * cell;
      const rx = lx * cos - ly * sin, ry = lx * sin + ly * cos;
      hw = Math.max(hw, Math.abs(rx));
      hh = Math.max(hh, Math.abs(ry));
    }
    boxes.push({
      id: p.id,
      x0: p.pos.x - hw, x1: p.pos.x + hw,
      y0: p.pos.y - hh, y1: p.pos.y + hh,
    });
  }

  // 越界量
  const overflows = [];
  for (const b of boxes) {
    const over = Math.max(0, -b.x0, b.x1 - W, -b.y0, b.y1 - H);
    overflows.push({ id: b.id, over });
  }

  // 两两交叠面积
  let maxOverlap = 0;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      if (ox > 0 && oy > 0) maxOverlap = Math.max(maxOverlap, ox * oy);
    }
  }

  // 压住目标板
  let overBoard = 0;
  if (layout) {
    for (const b of boxes) {
      const ox = Math.min(b.x1, layout.boardX + layout.boardW) - Math.max(b.x0, layout.boardX);
      const oy = Math.min(b.y1, layout.boardY + layout.boardH) - Math.max(b.y0, layout.boardY);
      if (ox > 0 && oy > 0) overBoard++;
    }
  }

  // 画布是否溢出视口
  const rect = canvas.getBoundingClientRect();
  const canvasOverflow = Math.max(0, rect.bottom - window.innerHeight, rect.right - window.innerWidth);

  return { overflows, maxOverlap, overBoard, canvasOverflow, W, H };
};

init();
