import { App } from "./app/index.ts";
import { Router } from "./router/index.ts";

async function main() {
  const app = new App();

  // Request logger middleware
  app.use((req, _res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
  });

  app.get("/", (_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<html><body><h1>Hello World</h1></body></html>");
  });

  // Path params + query string
  app.get("/users/:id", (req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: req.params.id, query: req.query }));
  });

  // Sub-router mounted under /api
  const api = new Router();
  api.get("/health", (_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  app.use("/api", api);

  // Error handler (4-arg middleware)
  app.use((err, _req, res, _next) => {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: (err as Error).message ?? String(err) }));
  });

  app.listen(8080, ({ port }) => {
    console.log(`HTTP Server listening on port ${port}`);
  });
}
main();
