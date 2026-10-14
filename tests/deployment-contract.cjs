const fs = require('fs');

function fail(message) {
  console.error(`deployment-contract: ${message}`);
  process.exit(1);
}

const source = fs.readFileSync('index.html', 'utf8');
const dist = fs.readFileSync('dist/index.html', 'utf8');
const formHost = fs.readFileSync('public/form-maker/index.html', 'utf8');
const deploy = fs.readFileSync('.github/workflows/deploy-pages.yml', 'utf8');
const integratedFormDeployment = 'AKfycbzbwo8SyyKNnNHzX2SjwlhipNFkiWus5j0pnuTcEEgFQm3FdLfsp0U8K_1OzMDAWf0';

const formHostUrls = [...formHost.matchAll(/https:\/\/script\.google\.com\/macros\/s\/([^/]+)\/exec/g)]
  .map((match) => match[1]);
if (formHostUrls.length !== 1 || formHostUrls.some((deploymentId) => deploymentId !== integratedFormDeployment)) {
  fail('form maker iframe must use the verified integrated Apps Script deployment, without a non-synchronizing direct link');
}
if (formHost.includes('フォームメーカーを直接開く')) {
  fail('form maker host must not offer the history-bypassing direct Apps Script route');
}

if (/\<div\s+id=["']root["']\s*\>\s*\<\/div\>/i.test(source)) {
  fail('source index has an empty #root; branch-source Pages would render a blank page');
}
if (!source.includes('static-fallback')) {
  fail('source index is missing the emergency static fallback');
}
if (!source.includes('<title>山歩会企画ツール一覧</title>')) {
  fail('source index title does not match the portal name');
}
for (const copy of [
  '山歩会の企画に使うツールをまとめています。',
  'YAMAPの画像から、登山計画書を作れます。',
  '参加者募集用のGoogleフォームを作れます。',
  '車割り・班割りと交通費の精算に使います。',
  '学務に出す書類を作れます。引き継ぎデータも使えます。',
]) {
  if (!source.includes(copy)) fail(`static fallback copy is missing: ${copy}`);
}
if (!dist.includes('/sanpokai-kikaku-portal/assets/')) {
  fail('Vite dist does not use the GitHub Pages base path');
}
if (dist.includes('/src/main.jsx')) {
  fail('dist still references Vite source instead of built assets');
}
if (!/path:\s*\.\/dist/.test(deploy)) {
  fail('Deploy Pages workflow is not publishing ./dist');
}

console.log('Pages deployment contract passed.');
