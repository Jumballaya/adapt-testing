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
    res.send("<html><body><h1>Hello World</h1></body></html>");
  });

  // Path params + query string
  app.get("/users/:id", (req, res) => {
    res.json({ id: req.params.id, query: req.query });
  });

  // Sub-router mounted under /api
  const api = new Router();
  api.get("/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.use("/api", api);

  // Error handler (4-arg middleware)
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: (err as Error).message ?? String(err) });
  });

  app.listen(8080, ({ port }) => {
    console.log(`HTTP Server listening on port ${port}`);
  });
}
main();
