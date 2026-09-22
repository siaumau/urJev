import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createEngine, JevError } from './engine.js';
import { systemOne } from './systemone.js';

const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
files['/feedback-example.js'] = ['feedback-example.js', 'text/javascript'];
files['/json-input.js'] = ['json-input.js', 'text/javascript'];
export function createApp(engine = createEngine({ backend: process.env.INFERENCE_BACKEND, url: process.env.INFERENCE_BACKEND === 'vllm' ? process.env.VLLM_URL : process.env.OLLAMA_URL, model: process.env.MODEL, timeout: Number(process.env.INFERENCE_TIMEOUT_MS || 120000) })) {
  const publicOrigin = process.env.PUBLIC_ORIGIN ? new URL(process.env.PUBLIC_ORIGIN).origin : null;
  const publicHost = publicOrigin ? new URL(publicOrigin).host : null;
  let active = false;
  return http.createServer(async (req, res) => {
    const requestStarted = performance.now();
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    try {
      const host = req.headers.host || '';
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) && host !== publicHost) return json(403, { error: { code: 'FORBIDDEN_HOST', message: '此網域未獲允許。' } });
      if (req.headers.origin && req.headers.origin !== (host === publicHost ? publicOrigin : `http://${host}`)) return json(403, { error: { code: 'FORBIDDEN_ORIGIN', message: '不允許跨來源存取。' } });
      if (req.method === 'GET' && req.url === '/api/health') return json(200, await engine.health());
      if (req.method === 'GET' && req.url === '/api/runtime') return json(200, await engine.runtime());
      if (req.method === 'POST' && ['/api/decide', '/v1/systemone'].includes(req.url)) {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new JevError(415, 'CONTENT_TYPE', '請使用 application/json。');
        let size = 0;
        const chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 65536) { json(413, { error: { code: 'BODY_TOO_LARGE', message: '請求上限為 64 KB。' } }); return; }
          chunks.push(chunk);
        }
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new JevError(400, 'INVALID_JSON', '請求不是合法 JSON。'); }
        if (active) throw new JevError(429, 'BUSY', '模型正在處理其他請求，請稍後重試。');
        active = true;
        try {
          const result = await (req.url === '/v1/systemone' ? systemOne(engine, body) : engine.decide(body));
          const serverMs = performance.now() - requestStarted;
          result.meta = { ...result.meta, server_ms: serverMs };
          res.setHeader('Server-Timing', `app;dur=${serverMs.toFixed(2)}`);
          return json(200, result);
        } finally { active = false; }
      }
      if (req.method === 'GET' && Object.hasOwn(files, req.url)) {
        const [name, type] = files[req.url];
        const content = await readFile(new URL(`../public/${name}`, import.meta.url));
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); return res.end(content);
      }
      json(404, { error: { code: 'NOT_FOUND', message: '找不到此路徑。' } });
    } catch (error) {
      json(error.status || 500, { error: { code: error.code || 'INTERNAL_ERROR', message: error.status ? error.message : '服務發生錯誤。' } });
    }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 15413);
  const server = createApp();
  server.listen(port, '127.0.0.1', () => console.log(`urJev → http://127.0.0.1:${port}`));
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
}
