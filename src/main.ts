import { App } from "./app/index.ts";
import type { Request, Response } from "./http/index.ts";
import { Router, type NextFunction } from "./router/index.ts";

async function main() {
  const app = new App();

  // Request logger middleware
  app.use((req, _res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
  });

  app.get("/", (_req, res) => {
    res.type("html").send("<html><body><h1>Hello World</h1></body></html>");
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

  // Error handler (4-arg middleware). TypeScript can't infer parameter
  // types from the overloaded use() signature when the function has 4
  // parameters, so we annotate them explicitly here.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: (err as Error).message ?? String(err) });
  });

  app.listen(8080, ({ port }) => {
    console.log(`HTTP Server listening on port ${port}`);
  });
}
main();
