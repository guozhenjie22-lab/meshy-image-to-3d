/**
 * server.js — 本地开发服务器（含 CORS 代理）
 * 启动: node server.js
 * 访问: http://localhost:8765
 *
 * 代理规则:
 *   GET /proxy?url=<encoded_url>  →  转发到目标 URL，添加 CORS 响应头
 */

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');

const PORT    = 8765;
const ROOT    = __dirname;
const LOG_FILE = path.join(__dirname, 'app.log');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.glb':  'model/gltf-binary',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
};

const server = http.createServer((req, res) => {
  const parsed  = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // ── 日志写入 ──────────────────────────────────────────────────
  if (pathname === '/log' && req.method === 'POST') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const line = body.trim();
      if (line) {
        fs.appendFile(LOG_FILE, line + '\n', () => {});
      }
      res.writeHead(204);
      res.end();
    });
    return;
  }

  // ── CORS 预检 ─────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.writeHead(204); res.end(); return;
  }

  // ── CORS 代理 ─────────────────────────────────────────────────
  if (pathname === '/proxy') {
    const target = parsed.query.url;
    if (!target) {
      res.writeHead(400); res.end('Missing ?url='); return;
    }
    console.log(`[Proxy] → ${target.slice(0, 80)}...`);

    const targetParsed = url.parse(target);
    const transport    = targetParsed.protocol === 'https:' ? https : http;

    const proxyReq = transport.get(target, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, {
        'Content-Type':                proxyRes.headers['content-type'] || 'application/octet-stream',
        'Content-Length':              proxyRes.headers['content-length'] || '',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control':               'public, max-age=600',
      });
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error('[Proxy] Error:', err.message);
      res.writeHead(502); res.end('Proxy error: ' + err.message);
    });
    return;
  }

  // ── 静态文件服务 ──────────────────────────────────────────────
  let filePath = path.join(ROOT, pathname === '/' ? 'index.html' : pathname);

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // 尝试作为目录下的 index.html
      const fallback = path.join(filePath, 'index.html');
      fs.stat(fallback, (e2, s2) => {
        if (e2 || !s2.isFile()) {
          res.writeHead(404); res.end('404 Not Found: ' + pathname);
        } else {
          serveFile(fallback, res);
        }
      });
      return;
    }
    serveFile(filePath, res);
  });
});

function serveFile(filePath, res) {
  const ext  = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  const stream = fs.createReadStream(filePath);
  res.writeHead(200, { 'Content-Type': mime });
  stream.pipe(res);
  stream.on('error', (err) => { res.end(); });
}

server.listen(PORT, () => {
  console.log(`✅ 服务器已启动: http://localhost:${PORT}`);
  console.log(`   代理地址示例: http://localhost:${PORT}/proxy?url=https://assets.meshy.ai/...`);
});
