import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const port = Number(process.env.PORT || 4174);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.wasm': 'application/wasm', '.gz': 'application/gzip' };

http.createServer(async (request, response) => {
  try {
    const decoded = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let requested = path.resolve(root, `.${decoded}`);
    if (!requested.startsWith(root + path.sep) && requested !== root) throw new Error('outside root');
    if ((await stat(requested)).isDirectory()) requested = path.join(requested, 'index.html');
    response.writeHead(200, { 'Content-Type': types[path.extname(requested)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(await readFile(requested));
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`PC-DMIS Report Comparer: http://127.0.0.1:${port}/`));
