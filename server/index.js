import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const web = path.join(root, 'public');
const data = path.join(root, 'data');
mkdirSync(data, { recursive: true });
const db = new DatabaseSync(path.join(data, 'analytics.sqlite'));
db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
export const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/health' && req.method === 'GET') return json(res, 200, { code: 200, data: { status: 'ok', storage: 'sqlite' } });
    if (url.pathname.startsWith('/prod-api/') || url.pathname.startsWith('/api/')) return json(res, 501, { code: 501, msg: '独立版尚未接入此接口或数据源：' + url.pathname });
    if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { code: 405, msg: '不支持此请求方法' });
    const name = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const target = path.resolve(web, '.' + name);
    if (!target.startsWith(web + path.sep) || !existsSync(target)) return json(res, 404, { code: 404, msg: '文件不存在' });
    const actual = await realpath(target), actualWeb = await realpath(web);
    if (!actual.startsWith(actualWeb + path.sep)) return json(res, 403, { code: 403, msg: '禁止访问' });
    const content = await readFile(actual);
    res.writeHead(200, { 'Content-Type': mime[path.extname(actual).toLowerCase()] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch { json(res, 400, { code: 400, msg: '请求无效' }); }
});
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  server.listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}`));
}
