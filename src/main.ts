import http, { ServerResponse, IncomingMessage } from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

type Router = (req: IncomingMessage, res: ServerResponse) => void;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, "..", "public");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".wasm": "application/wasm",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

function contentTypeFor(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

function serveArtifact(req: IncomingMessage, res: ServerResponse): boolean {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const match = url.pathname.match(/^\/artifact\/(.+)$/);
  if (!match) return false;

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD", "Content-Type": "text/plain" });
    res.end("Method Not Allowed");
    return true;
  }

  const requested = decodeURIComponent(match[1]);
  const filePath = path.resolve(PUBLIC_DIR, requested);

  // Prevent path traversal outside of the public folder.
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden");
    return true;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }

    res.writeHead(200, {
      "Content-Type": contentTypeFor(filePath),
      "Content-Length": stat.size,
    });

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    const stream = fs.createReadStream(filePath);
    stream.on("error", () => {
      res.destroy();
    });
    stream.pipe(res);
  });

  return true;
}

function createServer(port: number, router: Router) {
  const server = http.createServer(router);
  const start = () => {
    server.listen(port, () => {
      console.log(`HTTP Server listening on port ${port}`);
    });
  };
  return {
    server,
    start,
  };
}

async function main() {
  const server = createServer(8080, (req, res) => {
    if (serveArtifact(req, res)) return;

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<html><body><h1>Hello World</h1></body></html>");
  });
  server.start();
}
main();
