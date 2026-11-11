/**
 * 原创角色美术库（纯矢量绘制，Canvas 2D）
 *
 * 设计约定：角色在 200×200 的设计坐标系内绘制，x∈[0,200]，y∈[-10,190]。
 * 统一基线：所有角色的脚底都落在 y=190，方便对齐到同一条地平线。
 * 幼态比例：大脑袋、小身子、大眼睛；全部原创造型，不涉及任何现有 IP。
 */

/* ---------------- 基础绘制工具 ---------------- */

function ellipse(ctx, x, y, rx, ry, fill, rot = 0) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
}

/** 柔和的不规则身体轮廓 */
function blob(ctx, cx, cy, rx, ry, wobble, seed) {
  const n = 8;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const w = 1 + Math.sin(a * 3 + seed) * wobble + Math.cos(a * 2 - seed) * wobble * 0.5;
    pts.push([cx + Math.cos(a) * rx * w, cy + Math.sin(a) * ry * w]);
  }
  ctx.beginPath();
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const m0 = mid(pts[n - 1], pts[0]);
  ctx.moveTo(m0[0], m0[1]);
  for (let i = 0; i < n; i++) {
    const cur = pts[i];
    const nxt = pts[(i + 1) % n];
    const m = mid(cur, nxt);
    ctx.quadraticCurveTo(cur[0], cur[1], m[0], m[1]);
  }
  ctx.closePath();
}

/**
 * 眼睛：深色虹膜 + 小高光。
 * 注意高光必须小（r*0.3），过大会让眼睛变成「白心空心圈」。
 */
function eye(ctx, x, y, r, opts = {}) {
  const { look = 0, iris = '#2B2320', pupil = true, glint = true } = opts;
  ellipse(ctx, x, y, r, r * 1.12, iris);
  if (pupil) ellipse(ctx, x + look * r * 0.14, y + r * 0.06, r * 0.5, r * 0.58, '#241C18');
  if (glint) {
    ellipse(ctx, x - r * 0.32 + look * r * 0.14, y - r * 0.36, r * 0.3, r * 0.3, '#FFFFFF');
    ellipse(ctx, x + r * 0.3 + look * r * 0.14, y + r * 0.3, r * 0.14, r * 0.14, 'rgba(255,255,255,0.8)');
  }
}

/** 腮红 */
function blush(ctx, x, y, rx, ry, color = 'rgba(255,138,128,0.45)') {
  ellipse(ctx, x, y, rx, ry, color);
}

/** 微笑弧线 */
function smile(ctx, x, y, w, h, lw = 5, color = '#4A3B35') {
  ctx.beginPath();
  ctx.moveTo(x - w, y);
  ctx.quadraticCurveTo(x, y + h, x + w, y);
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.stroke();
}

/** 倒 U 形嘴（猫科） */
function wMouth(ctx, x, y, w, lw = 4.5, color = '#4A3B35') {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x - w / 2, y + w * 0.55, x - w, y);
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + w / 2, y + w * 0.55, x + w, y);
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.stroke();
}

/** 圆角矩形 */
function roundRect(ctx, x, y, w, h, r, fill) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
}

/* ---------------- 角色 1：小狗豆豆 ---------------- */
function drawDog(ctx) {
  // 后腿（底边落在 y=190）
  ellipse(ctx, 72, 177, 16, 13, '#C98A4B');
  ellipse(ctx, 128, 177, 16, 13, '#C98A4B');
  // 身体
  blob(ctx, 100, 140, 44, 38, 0.03, 1.2);
  ctx.fillStyle = '#F2D2A0';
  ctx.fill();
  ellipse(ctx, 100, 150, 27, 26, '#FBEBD0');
  // 尾巴
  ctx.beginPath();
  ctx.moveTo(141, 140);
  ctx.quadraticCurveTo(166, 132, 160, 108);
  ctx.strokeStyle = '#C98A4B';
  ctx.lineWidth = 13;
  ctx.lineCap = 'round';
  ctx.stroke();
  // 头
  ellipse(ctx, 100, 84, 58, 53, '#F5DCB0');
  // 垂耳画在头之后，向下耷拉并露出轮廓
  ellipse(ctx, 48, 88, 19, 42, '#A9682F', -0.24);
  ellipse(ctx, 48, 92, 10, 30, '#8E5228', -0.24);
  ellipse(ctx, 152, 88, 19, 42, '#A9682F', 0.24);
  ellipse(ctx, 152, 92, 10, 30, '#8E5228', 0.24);
  // 口鼻区
  ellipse(ctx, 100, 108, 33, 26, '#FBEBD0');
  // 眼睛
  eye(ctx, 82, 74, 9.5);
  eye(ctx, 118, 74, 9.5);
  // 眉毛
  ctx.beginPath();
  ctx.moveTo(72, 56); ctx.quadraticCurveTo(82, 50, 92, 55);
  ctx.moveTo(108, 55); ctx.quadraticCurveTo(118, 50, 128, 56);
  ctx.strokeStyle = '#A9682F';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.stroke();
  // 鼻子
  ellipse(ctx, 100, 94, 9, 7, '#4A3B35');
  // 嘴 + 舌头
  ctx.beginPath();
  ctx.moveTo(100, 101); ctx.lineTo(100, 109);
  ctx.strokeStyle = '#4A3B35';
  ctx.lineWidth = 4;
  ctx.stroke();
  smile(ctx, 100, 108, 12, 9, 4);
  ellipse(ctx, 100, 120, 8, 10, '#F2778A');
  // 腮红
  blush(ctx, 66, 98, 11, 7);
  blush(ctx, 134, 98, 11, 7);
  // 项圈
  roundRect(ctx, 78, 134, 44, 13, 6, '#4FA9E8');
  ellipse(ctx, 100, 150, 7, 8, '#FFD24A');
}

/* ---------------- 角色 2：小猫团子 ---------------- */
function drawCat(ctx) {
  // 后腿
  ellipse(ctx, 72, 177, 16, 13, '#E58A3C');
  ellipse(ctx, 128, 177, 16, 13, '#E58A3C');
  // 身体
  blob(ctx, 100, 142, 42, 36, 0.03, 2.4);
  ctx.fillStyle = '#F5A455';
  ctx.fill();
  ellipse(ctx, 100, 152, 26, 24, '#FFE2BC');
  // 尾巴
  ctx.beginPath();
  ctx.moveTo(139, 144);
  ctx.bezierCurveTo(168, 142, 172, 110, 152, 100);
  ctx.strokeStyle = '#E58A3C';
  ctx.lineWidth = 12;
  ctx.lineCap = 'round';
  ctx.stroke();
  // 头
  ellipse(ctx, 100, 86, 55, 50, '#F5A455');
  // 耳朵画在头之后，用更深的橙色与头部区分，避免边界消失
  ctx.beginPath();
  ctx.moveTo(54, 58); ctx.lineTo(68, 14); ctx.lineTo(97, 44);
  ctx.closePath();
  ctx.fillStyle = '#E8893C'; ctx.fill();
  ctx.beginPath();
  ctx.moveTo(62, 51); ctx.lineTo(69, 26); ctx.lineTo(86, 45);
  ctx.closePath();
  ctx.fillStyle = '#F7A9B8'; ctx.fill();
  ctx.beginPath();
  ctx.moveTo(146, 58); ctx.lineTo(132, 14); ctx.lineTo(103, 44);
  ctx.closePath();
  ctx.fillStyle = '#E8893C'; ctx.fill();
  ctx.beginPath();
  ctx.moveTo(138, 51); ctx.lineTo(131, 26); ctx.lineTo(114, 45);
  ctx.closePath();
  ctx.fillStyle = '#F7A9B8'; ctx.fill();
  // 额头虎斑
  ctx.strokeStyle = '#D9822F';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(92, 40); ctx.lineTo(94, 58);
  ctx.moveTo(100, 36); ctx.lineTo(100, 56);
  ctx.moveTo(108, 40); ctx.lineTo(106, 58);
  ctx.stroke();
  // 口鼻区
  ellipse(ctx, 100, 108, 30, 22, '#FFE2BC');
  // 眼睛
  eye(ctx, 81, 80, 9, { iris: '#3E7D5A' });
  eye(ctx, 119, 80, 9, { iris: '#3E7D5A' });
  // 鼻子
  ctx.beginPath();
  ctx.moveTo(94, 97); ctx.lineTo(106, 97); ctx.lineTo(100, 105);
  ctx.closePath();
  ctx.fillStyle = '#F2778A'; ctx.fill();
  // 嘴
  wMouth(ctx, 100, 106, 20);
  // 胡须
  ctx.strokeStyle = 'rgba(90,70,60,0.6)';
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(72, 102); ctx.lineTo(38, 94);
  ctx.moveTo(72, 110); ctx.lineTo(36, 112);
  ctx.moveTo(128, 102); ctx.lineTo(162, 94);
  ctx.moveTo(128, 110); ctx.lineTo(164, 112);
  ctx.stroke();
  // 腮红
  blush(ctx, 68, 100, 10, 6);
  blush(ctx, 132, 100, 10, 6);
}

/* ---------------- 角色 3：小兔奶糖 ---------------- */
function drawRabbit(ctx) {
  // 后腿
  ellipse(ctx, 70, 176, 18, 14, '#E9DED2');
  ellipse(ctx, 130, 176, 18, 14, '#E9DED2');
  // 身体
  blob(ctx, 100, 144, 40, 34, 0.03, 3.1);
  ctx.fillStyle = '#F0E4D6';
  ctx.fill();
  ellipse(ctx, 100, 154, 25, 22, '#FBF3E9');
  // 尾巴
  ellipse(ctx, 146, 150, 14, 14, '#FBF3E9');
  // 头
  ellipse(ctx, 100, 92, 53, 48, '#F5EADC');
  // 长耳朵画在头之后，外耳用较深的米色与头部区分
  ellipse(ctx, 79, 40, 15, 36, '#DFCFBB', -0.13);
  ellipse(ctx, 121, 40, 15, 36, '#DFCFBB', 0.13);
  ellipse(ctx, 79, 42, 8, 27, '#F09BB0', -0.13);
  ellipse(ctx, 121, 42, 8, 27, '#F09BB0', 0.13);
  // 口鼻区（比门牙略深，让白色门牙可见）
  ellipse(ctx, 100, 112, 28, 21, '#EADCCB');
  // 眼睛
  eye(ctx, 82, 86, 8.5);
  eye(ctx, 118, 86, 8.5);
  // 鼻子
  ellipse(ctx, 100, 100, 7, 5.5, '#F2778A');
  // 嘴
  ctx.beginPath();
  ctx.moveTo(100, 106); ctx.lineTo(100, 113);
  ctx.strokeStyle = '#4A3B35'; ctx.lineWidth = 3.4; ctx.stroke();
  smile(ctx, 100, 112, 9, 7, 3.4);
  // 门牙（白色 + 描边，避免与口鼻糊在一起）
  roundRect(ctx, 93, 116, 6, 12, 2.5, '#FFFFFF');
  roundRect(ctx, 101, 116, 6, 12, 2.5, '#FFFFFF');
  ctx.strokeStyle = '#D8CFC4';
  ctx.lineWidth = 1.4;
  ctx.strokeRect(93.7, 116.7, 4.6, 10.6);
  ctx.strokeRect(101.7, 116.7, 4.6, 10.6);
  // 腮红
  blush(ctx, 70, 104, 11, 7);
  blush(ctx, 130, 104, 11, 7);
}

/* ---------------- 角色 4：企鹅冰冰 ---------------- */
function drawPenguin(ctx) {
  // 脚
  ellipse(ctx, 78, 182, 20, 8, '#F5A03C');
  ellipse(ctx, 122, 182, 20, 8, '#F5A03C');
  // 身体
  blob(ctx, 100, 124, 46, 54, 0.02, 4.3);
  ctx.fillStyle = '#33455C';
  ctx.fill();
  // 肚皮
  ellipse(ctx, 100, 130, 33, 42, '#FBFBF7');
  // 鳍
  ellipse(ctx, 50, 124, 12, 30, '#2A3A4E', -0.28);
  ellipse(ctx, 150, 124, 12, 30, '#2A3A4E', 0.28);
  // 头
  ellipse(ctx, 100, 64, 44, 40, '#33455C');
  // 脸部白斑
  ellipse(ctx, 83, 70, 17, 20, '#FBFBF7');
  ellipse(ctx, 117, 70, 17, 20, '#FBFBF7');
  // 眼睛（实心深色 + 高光）
  eye(ctx, 83, 68, 7.5, { pupil: false });
  eye(ctx, 117, 68, 7.5, { pupil: false });
  // 喙
  ctx.beginPath();
  ctx.moveTo(100, 80); ctx.lineTo(88, 94); ctx.quadraticCurveTo(100, 104, 112, 94);
  ctx.closePath();
  ctx.fillStyle = '#F5A03C'; ctx.fill();
  // 腮红
  blush(ctx, 68, 92, 9, 5.5);
  blush(ctx, 132, 92, 9, 5.5);
}

/* ---------------- 角色 5：熊猫圆圆 ---------------- */
function drawPanda(ctx) {
  // 后腿
  ellipse(ctx, 72, 177, 16, 13, '#3A3A3A');
  ellipse(ctx, 128, 177, 16, 13, '#3A3A3A');
  // 身体
  blob(ctx, 100, 142, 43, 37, 0.03, 5.5);
  ctx.fillStyle = '#F7F5F0';
  ctx.fill();
  // 手臂
  ellipse(ctx, 52, 142, 14, 26, '#3A3A3A', 0.2);
  ellipse(ctx, 148, 142, 14, 26, '#3A3A3A', -0.2);
  // 耳朵（高于头顶，露出轮廓）
  ellipse(ctx, 62, 36, 17, 17, '#3A3A3A');
  ellipse(ctx, 138, 36, 17, 17, '#3A3A3A');
  // 头
  ellipse(ctx, 100, 82, 55, 50, '#F7F5F0');
  // 黑眼圈
  ellipse(ctx, 78, 82, 17, 20, '#3A3A3A', -0.22);
  ellipse(ctx, 122, 82, 17, 20, '#3A3A3A', 0.22);
  // 眼睛（白眼白 + 黑瞳孔）
  ellipse(ctx, 79, 80, 8.5, 9.5, '#FFFFFF');
  ellipse(ctx, 80, 82, 4.4, 5, '#2A2A2A');
  ellipse(ctx, 77.5, 78, 2.4, 2.4, '#FFFFFF');
  ellipse(ctx, 121, 80, 8.5, 9.5, '#FFFFFF');
  ellipse(ctx, 120, 82, 4.4, 5, '#2A2A2A');
  ellipse(ctx, 117.5, 78, 2.4, 2.4, '#FFFFFF');
  // 鼻子
  ellipse(ctx, 100, 102, 9, 6.5, '#3A3A3A');
  // 嘴
  ctx.beginPath();
  ctx.moveTo(100, 108); ctx.lineTo(100, 114);
  ctx.strokeStyle = '#4A3B35'; ctx.lineWidth = 3.6; ctx.stroke();
  smile(ctx, 100, 113, 11, 8, 3.6);
  // 腮红
  blush(ctx, 66, 104, 11, 6.5);
  blush(ctx, 134, 104, 11, 6.5);
}

/* ---------------- 角色 6：小鸡啾啾 ---------------- */
function drawChick(ctx) {
  // 脚
  ctx.strokeStyle = '#F5A03C';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(88, 172); ctx.lineTo(88, 186);
  ctx.moveTo(81, 189); ctx.lineTo(88, 186); ctx.lineTo(95, 189);
  ctx.moveTo(112, 172); ctx.lineTo(112, 186);
  ctx.moveTo(105, 189); ctx.lineTo(112, 186); ctx.lineTo(119, 189);
  ctx.stroke();
  // 身体
  blob(ctx, 100, 126, 50, 50, 0.02, 6.2);
  ctx.fillStyle = '#FFD65C';
  ctx.fill();
  // 翅膀
  ellipse(ctx, 50, 128, 15, 27, '#F7C23F', -0.18);
  ellipse(ctx, 150, 128, 15, 27, '#F7C23F', 0.18);
  // 头
  ellipse(ctx, 100, 90, 47, 43, '#FFDD6E');
  // 呆毛画在头之后，才不会被盖住
  ctx.beginPath();
  ctx.moveTo(92, 58);
  ctx.quadraticCurveTo(84, 28, 108, 14);
  ctx.quadraticCurveTo(112, 36, 106, 56);
  ctx.closePath();
  ctx.fillStyle = '#F7C23F'; ctx.fill();
  // 眼睛
  eye(ctx, 84, 86, 8);
  eye(ctx, 116, 86, 8);
  // 喙
  ctx.beginPath();
  ctx.moveTo(90, 100); ctx.lineTo(110, 100); ctx.lineTo(100, 114);
  ctx.closePath();
  ctx.fillStyle = '#F5A03C'; ctx.fill();
  // 腮红
  blush(ctx, 70, 104, 10, 6.5, 'rgba(255,140,120,0.5)');
  blush(ctx, 130, 104, 10, 6.5, 'rgba(255,140,120,0.5)');
}

export const CHARACTERS = {
  dog: drawDog,
  cat: drawCat,
  rabbit: drawRabbit,
  penguin: drawPenguin,
  panda: drawPanda,
  chick: drawChick,
};

/** 每个角色的描边色：需与各自背景保持足够明度差，才能把角色「托」出来 */
export const OUTLINE = {
  dog: '#7A4A22',
  cat: '#A85A18',
  rabbit: '#6B5741',
  penguin: '#1E2B38',
  panda: '#242424',
  chick: '#8A5A12',
};

/* ---------------- 渲染管线 ---------------- */

/** 设计坐标系：x∈[0,200]，y∈[-10,190]，脚底基线 y=190 */
export const DESIGN = { w: 200, top: -10, bottom: 190, base: 190 };

const K = 4;              // 内部超采样倍率
const OUTLINE_W = 2.4;    // 描边宽度（设计单位）

/** 把角色渲染到离屏画布（超采样） */
function renderCharacterCanvas(kind) {
  const w = DESIGN.w * K;
  const h = (DESIGN.bottom - DESIGN.top) * K;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const cx = c.getContext('2d');
  cx.save();
  cx.translate(0, -DESIGN.top * K);
  cx.scale(K, K);
  (CHARACTERS[kind] || drawDog)(cx);
  cx.restore();
  return c;
}

/**
 * 生成带描边的角色图：
 * 把角色转成剪影 → 多方向平移叠画得到膨胀轮廓 → 覆盖原图。
 * 只有整体外轮廓会出现描边，内部重叠处不会出现多余线条。
 */
function withOutline(charC, color) {
  const w = charC.width, h = charC.height;
  const sil = document.createElement('canvas');
  sil.width = w; sil.height = h;
  const sctx = sil.getContext('2d');
  sctx.drawImage(charC, 0, 0);
  sctx.globalCompositeOperation = 'source-in';
  sctx.fillStyle = color;
  sctx.fillRect(0, 0, w, h);

  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const octx = out.getContext('2d');
  const R = OUTLINE_W * K;
  const N = 24;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    octx.drawImage(sil, Math.cos(a) * R, Math.sin(a) * R);
  }
  octx.drawImage(charC, 0, 0);
  return out;
}

/** 计算角色缩放与落地位置：保证内容完整落在画布内且统一贴地 */
export function characterLayout(w, h) {
  const ground = h * 0.87;
  const contentH = DESIGN.base - DESIGN.top;   // 200
  const unitH = (ground - h * 0.05) / contentH;
  const unitW = (w * 0.56) / (DESIGN.w * 0.65);
  const unit = Math.min(unitH, unitW);
  return { unit, ground, x: w / 2 - DESIGN.w * 0.5 * unit };
}

/* ---------------- 场景背景 ---------------- */

/**
 * 场景配色。注意色相要跟角色「拉开距离」：
 * 白兔配紫、黄鸡配薄荷绿、熊猫配浅绿、企鹅配冰蓝，都是互补或高明度差方案。
 */
export const PALETTES = {
  meadow:  { sky1: '#CFEBFF', sky2: '#EAF7FF', hill: '#A8DC8C', ground: '#8FCB74', accent: '#FFD24A', cloud: '#FFFFFF' },
  sunny:   { sky1: '#FFE9B8', sky2: '#FFF6E0', hill: '#FFC97A', ground: '#F5B75C', accent: '#FF8C42', cloud: '#FFFFFF' },
  lilac:   { sky1: '#E0D6FF', sky2: '#F5F0FF', hill: '#C3B2F7', ground: '#A490EA', accent: '#7B5AE0', cloud: '#FFFFFF' },
  polar:   { sky1: '#A8D8FF', sky2: '#E2F3FF', hill: '#BFE0F2', ground: '#96CBE6', accent: '#3FA9E0', cloud: '#FFFFFF' },
  bamboo:  { sky1: '#CFEFC0', sky2: '#EFFBE8', hill: '#A6DC8C', ground: '#83C96F', accent: '#4FC08A', cloud: '#FFFFFF' },
  aqua:    { sky1: '#B2EFE2', sky2: '#E3FBF4', hill: '#83D8C2', ground: '#5FC0A6', accent: '#FFB03A', cloud: '#FFFFFF' },
};

/**
 * 绘制完整场景（背景 + 角色）到给定画布
 */
export function drawScene(ctx, w, h, kind, pal) {
  const p = PALETTES[pal] || PALETTES.meadow;

  // 天空渐变
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, p.sky1);
  g.addColorStop(1, p.sky2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // 太阳（放在右上角，避开角色）
  ctx.beginPath();
  ctx.arc(w * 0.87, h * 0.1, Math.min(w, h) * 0.075, 0, Math.PI * 2);
  ctx.fillStyle = p.accent;
  ctx.globalAlpha = 0.9;
  ctx.fill();
  ctx.globalAlpha = 1;

  // 云朵（分列左右，避开中间的角色）
  const cloud = (cx, cy, s) => {
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.5, 0, Math.PI * 2);
    ctx.arc(cx + s * 0.42, cy + s * 0.1, s * 0.38, 0, Math.PI * 2);
    ctx.arc(cx - s * 0.42, cy + s * 0.12, s * 0.34, 0, Math.PI * 2);
    ctx.arc(cx + s * 0.08, cy - s * 0.28, s * 0.36, 0, Math.PI * 2);
    ctx.fillStyle = p.cloud;
    ctx.fill();
  };
  cloud(w * 0.13, h * 0.15, Math.min(w, h) * 0.17);
  cloud(w * 0.87, h * 0.32, Math.min(w, h) * 0.11);

  // 远山
  ctx.beginPath();
  ctx.moveTo(0, h * 0.72);
  ctx.quadraticCurveTo(w * 0.25, h * 0.56, w * 0.52, h * 0.7);
  ctx.quadraticCurveTo(w * 0.78, h * 0.82, w, h * 0.66);
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = p.hill;
  ctx.fill();

  // 草地
  ctx.beginPath();
  ctx.moveTo(0, h * 0.84);
  ctx.quadraticCurveTo(w * 0.5, h * 0.78, w, h * 0.85);
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = p.ground;
  ctx.fill();

  // 小草
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = Math.max(2, h * 0.008);
  ctx.lineCap = 'round';
  for (let i = 0; i < 7; i++) {
    const x = (w / 7) * i + w * 0.03;
    const y = h * 0.93;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 3, y - h * 0.05);
    ctx.moveTo(x, y);
    ctx.lineTo(x + 4, y - h * 0.06);
    ctx.stroke();
  }

  // 角色
  const { unit, ground, x } = characterLayout(w, h);
  const charImg = withOutline(renderCharacterCanvas(kind), OUTLINE[kind] || '#5A4034');

  // 落地阴影
  ctx.beginPath();
  ctx.ellipse(x + DESIGN.w * 0.5 * unit, ground + unit * 1.5, unit * 34, unit * 5.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(60,40,30,0.16)';
  ctx.fill();

  ctx.drawImage(charImg, x, ground - (DESIGN.base - DESIGN.top) * unit, DESIGN.w * unit, (DESIGN.bottom - DESIGN.top) * unit);
}

/**
 * 生成角色的缩略图（用于关卡选择）
 */
export function drawThumb(ctx, w, h, kind, pal) {
  const p = PALETTES[pal] || PALETTES.meadow;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, p.sky1);
  g.addColorStop(1, p.sky2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  const { unit, ground, x } = characterLayout(w, h);
  const charImg = withOutline(renderCharacterCanvas(kind), OUTLINE[kind] || '#5A4034');
  ctx.drawImage(charImg, x, ground - (DESIGN.base - DESIGN.top) * unit, DESIGN.w * unit, (DESIGN.bottom - DESIGN.top) * unit);
}
