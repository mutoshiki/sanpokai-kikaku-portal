const fs = require('fs');

function fail(message) {
  console.error(`deployment-contract: ${message}`);
  process.exit(1);
}

const source = fs.readFileSync('index.html', 'utf8');
const dist = fs.readFileSync('dist/index.html', 'utf8');
const deploy = fs.readFileSync('.github/workflows/deploy-pages.yml', 'utf8');

if (/\<div\s+id=["']root["']\s*\>\s*\<\/div\>/i.test(source)) {
  fail('source index has an empty #root; branch-source Pages would render a blank page');
}
if (!source.includes('static-fallback')) {
  fail('source index is missing the emergency static fallback');
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
