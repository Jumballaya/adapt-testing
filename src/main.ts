import http, { IncomingMessage, ServerResponse } from "http";
import { Router } from "./router/index.ts";

function createServer(
  port: number,
  handler: (req: IncomingMessage, res: ServerResponse) => void,
) {
  const server = http.createServer(handler);
  const start = () => {
    server.listen(port, () => {
      console.log(`HTTP Server listening on port ${port}`);
    });
  };
  return { server, start };
}

async function main() {
  const router = new Router();

  // Request logger middleware
  router.use((req, _res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
  });

  router.get("/", (_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<html><body><h1>Hello World</h1></body></html>");
  });

  // Path params + query string
  router.get("/users/:id", (req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: req.params.id, query: req.query }));
  });

  // Sub-router mounted under /api
  const api = new Router();
  api.get("/health", (_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  router.use("/api", api);

  // Error handler (4-arg middleware)
  router.use((err, _req, res, _next) => {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: (err as Error).message ?? String(err) }));
  });

  const server = createServer(8080, router.handle);
  server.start();
}
main();
