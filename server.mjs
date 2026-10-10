import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const types = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".mjs":"text/javascript; charset=utf-8", ".svg":"image/svg+xml" };
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const candidate = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (candidate !== root && !candidate.startsWith(root + path.sep)) { res.writeHead(403).end("Forbidden"); return; }
    const data = await readFile(candidate);
    res.writeHead(200, { "Content-Type": types[path.extname(candidate)] || "application/octet-stream", "Cache-Control":"no-store", "X-Content-Type-Options":"nosniff" }).end(data);
  } catch { res.writeHead(404, { "Content-Type":"text/plain; charset=utf-8" }).end("Not found"); }
});
const port = Number(process.env.PORT || 4173);
server.listen(port, "127.0.0.1", () => console.log(`CalWeave at http://127.0.0.1:${port}`));
