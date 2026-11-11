/**
 * 构建单文件版本：把 4 个 ES 模块合并成一个自包含 HTML
 * 做法：每个模块包一层 IIFE，通过 window.__MOD 暴露所需符号，避免顶层命名冲突
 * 运行：node build-single.mjs
 */
import { readFileSync, writeFileSync } from 'fs';

const ROOT = new URL('.', import.meta.url).pathname;

/* 读取 HTML 外壳，替换 script 标签 */
let html = readFileSync(`${ROOT}/index.html`, 'utf8');

/* --- puzzle-parts.js：纯逻辑，直接内联（无 DOM 依赖，命名不与其它模块冲突） --- */
const parts = readFileSync(`${ROOT}/puzzle-parts.js`, 'utf8')
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+(const|function|let|var|class)\s/gm, '$1 ')
  .replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, '');

/* --- characters.js：暴露 drawScene / drawThumb --- */
const characters = readFileSync(`${ROOT}/characters.js`, 'utf8')
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+(const|function|let|var|class)\s/gm, '$1 ')
  .replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, '');

/* --- audio.js：暴露 Audio2 --- */
const audio = readFileSync(`${ROOT}/audio.js`, 'utf8')
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+(const|function|let|var|class)\s/gm, '$1 ')
  .replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, '');

/* --- puzzle-game.js：去掉 import，改为从全局取 --- */
const game = readFileSync(`${ROOT}/puzzle-game.js`, 'utf8')
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^(\s*)const \{([^}]+)\}\s*=\s*window\.__P;/gm, 'const {$2} = window.__P;');

const bundle = `
/* ============================================================
 * 拼图乐园 · 单文件版
 * 四个模块合并为一个 IIFE，作用域隔离，无需构建、无外部依赖
 * ============================================================ */
(function () {
'use strict';

${parts}

/* ===== characters.js ===== */
${characters}

/* ===== audio.js ===== */
${audio}

/* ===== puzzle-game.js ===== */
${game}

})();
`;

html = html.replace(
  '<script type="module" src="./puzzle-game.js"></script>',
  `<script>\n${bundle}\n</script>`
);

const out = `${ROOT}拼图乐园.html`;
writeFileSync(out, html, 'utf8');
console.log(`✅ 已生成单文件: ${out}`);
console.log(`   体积: ${(Buffer.byteLength(html) / 1024).toFixed(1)} KB`);
