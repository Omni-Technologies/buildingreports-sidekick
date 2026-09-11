// Zero-dependency static file server for dev/fake-report/ — see
// docs/fake-report-testing.md. Run with `npm run fake-report`.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = 8873;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const target = path.normalize(path.join(root, decoded));
  if (!target.startsWith(root)) return null; // reject path traversal
  return target;
}

const server = createServer(async (req, res) => {
  const requestedPath = req.url === '/' ? '/index.html' : req.url;
  const filePath = safeJoin(ROOT, requestedPath);
  if (!filePath) {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }
  try {
    const data = await readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found: ' + requestedPath);
  }
});

const port = Number(process.env.FAKE_REPORT_PORT) || DEFAULT_PORT;
server.listen(port, () => {
  console.log(`Fake BuildingReports Device Editor running at http://localhost:${port}/`);
  console.log('Open that URL in Chrome, load the unpacked extension, then click its toolbar icon while this tab is active.');
  console.log('Ctrl+C to stop.');
});
