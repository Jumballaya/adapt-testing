import { App } from "./app/index.ts";
import { Router, json, cookieParser, BodyParseError } from "./router/index.ts";

async function main() {
  const app = new App();

  // Request logger middleware
  app.use((req, _res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
  });

  // Parse JSON request bodies into req.body and cookies into req.cookies
  app.use(json());
  app.use(cookieParser());

  // Echo the parsed JSON body back to the client
  app.post("/echo", (req, res) => {
    res.json({ received: req.body });
  });

  // Track visits with a cookie
  app.get("/visits", (req, res) => {
    const previous = Number(req.cookies?.visits);
    const count = (Number.isFinite(previous) ? previous : 0) + 1;
    res.cookie("visits", String(count), { httpOnly: true, sameSite: "lax" });
    res.json({ visits: count });
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
    const status = err instanceof BodyParseError ? err.status : 500;
    res.status(status).json({ error: (err as Error).message ?? String(err) });
  });

  app.listen(8080, ({ port }) => {
    console.log(`HTTP Server listening on port ${port}`);
  });
}
main();
