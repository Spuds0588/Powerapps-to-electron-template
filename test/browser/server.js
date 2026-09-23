// [PowerApp Desktop] test/browser/server.js
//
// A ~60-line static file server. The browser tests need `wizard.html` on an
// `http://127.0.0.1` origin rather than `file://` so that local storage, the
// native module loader and the meta-refresh in `index.html` all behave the way
// they do on GitHub Pages.
//
// Nothing in here is imported by the app itself.

'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

/**
 * Serves `root` on an ephemeral loopback port.
 *
 * @param {string} [root] Directory to serve (defaults to the repository root).
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void> }>}
 */
function startStaticServer(root = ROOT) {
  const server = http.createServer((request, response) => {
    let filePath = path.join(root, decodeURIComponent(new URL(request.url, 'http://localhost').pathname));

    // Never serve anything outside the repository.
    if (!filePath.startsWith(root)) {
      response.writeHead(403).end('Forbidden');
      return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }

    fs.readFile(filePath, (error, body) => {
      if (error) {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
        return;
      }
      const type = CONTENT_TYPES[path.extname(filePath)] || 'application/octet-stream';
      response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }).end(body);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        port,
        close: () => new Promise((done) => server.close(() => done()))
      });
    });
  });
}

module.exports = { ROOT, startStaticServer };
