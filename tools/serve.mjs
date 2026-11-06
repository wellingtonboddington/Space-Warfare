// Development server: rebuilds the bundle on every request (esbuild is fast) and serves dev.html.
// Usage: node tools/serve.mjs [port]   → http://localhost:8080/dev.html
import * as esbuild from 'esbuild';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { config, ROOT } from './esbuild.config.mjs';

const port = +process.argv[2] || 8080;
const ctx = await esbuild.context({ ...config({ minify: false }), sourcemap: 'inline', write: false });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.css': 'text/css' };

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/bundle.js') {
      const r = await ctx.rebuild();
      res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
      return res.end(r.outputFiles[0].text);
    }
    const rel = url.pathname === '/' ? '/dev.html' : url.pathname;
    const p = normalize(join(ROOT, rel));
    if (!p.startsWith(ROOT) || !existsSync(p) || statSync(p).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(readFileSync(p));
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(String(e.stack || e));
  }
}).listen(port, () => console.log(`Severance dev server: http://localhost:${port}/dev.html`));
