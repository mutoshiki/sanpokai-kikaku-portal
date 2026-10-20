const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

function serveDist() {
  const root = path.resolve(process.cwd(), 'dist');
  const base = '/sanpokai-kikaku-portal/';
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (!pathname.startsWith(base)) { response.writeHead(404).end('Not found'); return; }
    const relative = decodeURIComponent(pathname.slice(base.length));
    if (relative === 'qa-empty.html') { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<!doctype html><html><head></head><body></body></html>'); return; }
    const candidate = path.resolve(root, relative || 'index.html');
    if (!candidate.startsWith(`${root}${path.sep}`) && candidate !== path.join(root, 'index.html')) { response.writeHead(403).end(); return; }
    const file = fs.existsSync(candidate) && fs.statSync(candidate).isDirectory() ? path.join(candidate, 'index.html') : candidate;
    fs.readFile(file, (error, content) => {
      if (error) { response.writeHead(404).end('Not found'); return; }
      const type = ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream';
      response.writeHead(200, { 'content-type': type }).end(content);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}${base}`,
  })));
}

module.exports = { serveDist };
