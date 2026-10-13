const fs = require('fs');

function fail(message) {
  console.error(`deployment-contract: ${message}`);
  process.exit(1);
}

const source = fs.readFileSync('index.html', 'utf8');
const dist = fs.readFileSync('dist/index.html', 'utf8');
const formHost = fs.readFileSync('public/form-maker/index.html', 'utf8');
const deploy = fs.readFileSync('.github/workflows/deploy-pages.yml', 'utf8');
const integratedFormDeployment = 'AKfycbw0R5VgBdSLS8aRDJDw7GUIEfHlXRZ6rPrOgjXmO2N7LvhuoGyS_opUCFTCSiUiDZw5';

const formHostUrls = [...formHost.matchAll(/https:\/\/script\.google\.com\/macros\/s\/([^/]+)\/exec/g)]
  .map((match) => match[1]);
if (formHostUrls.length !== 2 || formHostUrls.some((deploymentId) => deploymentId !== integratedFormDeployment)) {
  fail('form maker iframe and direct link must use the verified integrated Apps Script deployment');
}

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
