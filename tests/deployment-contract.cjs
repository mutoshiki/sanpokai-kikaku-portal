const fs = require('fs');

function fail(message) {
  console.error(`deployment-contract: ${message}`);
  process.exit(1);
}

const source = fs.readFileSync('index.html', 'utf8');
const dist = fs.readFileSync('dist/index.html', 'utf8');
const formSource = fs.readFileSync('form-maker/index.html', 'utf8');
const formDist = fs.readFileSync('dist/form-maker/index.html', 'utf8');
const deploy = fs.readFileSync('.github/workflows/deploy-pages.yml', 'utf8');

if (/\<div\s+id=["']root["']\s*\>\s*\<\/div\>/i.test(source)) {
  fail('source index has an empty #root; branch-source Pages would render a blank page');
}
if (!source.includes('static-fallback')) fail('source index is missing the emergency static fallback');
if (!source.includes('<title>山歩会企画ツール一覧</title>')) fail('source index title does not match the portal name');
for (const copy of [
  '山歩会の企画に使うツールをまとめています。',
  'YAMAPの画像から登山計画書を作成します。',
  '参加者募集用のGoogleフォームを作成します。',
  '車割り・班割りと交通費の精算を行います。',
  '学務に提出する書類を作成します。',
]) {
  if (!source.includes(copy)) fail(`static fallback copy is missing: ${copy}`);
}
if (!dist.includes('/sanpokai-kikaku-portal/assets/')) fail('Vite dist does not use the GitHub Pages base path');
if (dist.includes('/src/main.jsx')) fail('dist still references Vite source instead of built assets');
if (!/path:\s*\.\/dist/.test(deploy)) fail('Deploy Pages workflow is not publishing ./dist');

if (!formSource.includes('<div id="root"></div>')) fail('same-origin form maker source entry is missing its React root');
if (!formDist.includes('<div id="root"></div>')) fail('built form maker entry is missing its React root');
if (/<iframe\b/i.test(formSource) || /<iframe\b/i.test(formDist)) fail('the form-maker route must not wait on an Apps Script iframe');
if (!/src="(?:\.\/|\/sanpokai-kikaku-portal\/)assets\/formMaker-[^\"]+\.js"/.test(formDist)) fail('form-maker dist does not reference its built JavaScript asset');
if (formDist.includes('/src/main.jsx')) fail('form-maker dist still references Vite source instead of built assets');

console.log('Pages deployment contract passed.');
