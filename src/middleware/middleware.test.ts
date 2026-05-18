import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { Router } from "../router/index.ts";
import { logger, jsonBody, cors, serveStatic, compose } from "./index.ts";

async function withServer<T>(
  router: Router,
  fn: (base: string) => Promise<T>,
): Promise<T> {
  const server = http.createServer(router.handle);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  }
}

// ---- logger ----

test("logger writes method, url, status and elapsed ms", async () => {
  const lines: string[] = [];
  let clock = 1000;
  const router = new Router();
  router.use(logger({ write: (l) => lines.push(l), now: () => (clock += 5) }));
  router.get("/x", (_req, res) => res.end("ok"));
  await withServer(router, async (base) => {
    await fetch(base + "/x");
    // Allow the finish event to flush.
    await new Promise((r) => setTimeout(r, 10));
  });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^GET \/x 200 \d+ms$/);
});

// ---- jsonBody ----

test("jsonBody parses application/json into req.body", async () => {
  const router = new Router();
  router.use(jsonBody());
  router.post("/echo", (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify((req as unknown as { body: unknown }).body));
  });
  await withServer(router, async (base) => {
    const res = await fetch(base + "/echo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ a: 1, b: "two" }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { a: 1, b: "two" });
  });
});

test("jsonBody ignores non-JSON content types", async () => {
  const router = new Router();
  router.use(jsonBody());
  router.post("/echo", (req, res) => {
    const body = (req as unknown as { body: unknown }).body;
    res.end(body === undefined ? "no-body" : "had-body");
  });
  await withServer(router, async (base) => {
    const res = await fetch(base + "/echo", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "hello",
    });
    assert.equal(await res.text(), "no-body");
  });
});

test("jsonBody rejects payloads over the configured limit", async () => {
  const router = new Router();
  router.use(jsonBody({ limit: 16 }));
  router.post("/echo", (_req, res) => res.end("should not reach"));
  await withServer(router, async (base) => {
    const big = JSON.stringify({ data: "x".repeat(1000) });
    const res = await fetch(base + "/echo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: big,
    });
    assert.equal(res.status, 413);
  });
});

test("jsonBody forwards parse errors to error middleware", async () => {
  const router = new Router();
  router.use(jsonBody());
  router.post("/echo", (_req, res) => res.end("nope"));
  router.use((err, _req, res, _next) => {
    res.statusCode = 400;
    res.end((err as Error).message);
  });
  await withServer(router, async (base) => {
    const res = await fetch(base + "/echo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    assert.equal(res.status, 400);
  });
});

// ---- cors ----

test("cors sets default Access-Control-Allow-Origin: *", async () => {
  const router = new Router();
  router.use(cors());
  router.get("/", (_req, res) => res.end("ok"));
  await withServer(router, async (base) => {
    const res = await fetch(base + "/");
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
  });
});

test("cors echoes allowed origin from an array and sets Vary", async () => {
  const router = new Router();
  router.use(cors({ origin: ["https://a.test", "https://b.test"] }));
  router.get("/", (_req, res) => res.end("ok"));
  await withServer(router, async (base) => {
    const res = await fetch(base + "/", {
      headers: { Origin: "https://b.test" },
    });
    assert.equal(res.headers.get("access-control-allow-origin"), "https://b.test");
    assert.equal(res.headers.get("vary"), "Origin");
  });
});

test("cors short-circuits preflight OPTIONS with 204", async () => {
  const router = new Router();
  router.use(cors({ allowedHeaders: ["X-Custom"], maxAge: 600 }));
  router.get("/", (_req, res) => res.end("ok"));
  await withServer(router, async (base) => {
    const res = await fetch(base + "/", {
      method: "OPTIONS",
      headers: {
        Origin: "https://x.test",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "X-Custom",
      },
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("access-control-allow-headers"), "X-Custom");
    assert.equal(res.headers.get("access-control-max-age"), "600");
  });
});

// ---- serveStatic ----

test("serveStatic serves files and falls through for missing paths", async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), "static-"));
  await fs.writeFile(join(dir, "hello.txt"), "hello world");
  await fs.writeFile(join(dir, "index.html"), "<h1>home</h1>");

  const router = new Router();
  router.use(serveStatic(dir));
  router.use((_req, res) => { res.statusCode = 404; res.end("fallthrough"); });

  await withServer(router, async (base) => {
    const file = await fetch(base + "/hello.txt");
    assert.equal(file.status, 200);
    assert.equal(file.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.equal(await file.text(), "hello world");

    const root = await fetch(base + "/");
    assert.equal(root.status, 200);
    assert.equal(await root.text(), "<h1>home</h1>");

    const missing = await fetch(base + "/nope.txt");
    assert.equal(missing.status, 404);
    assert.equal(await missing.text(), "fallthrough");
  });

  await fs.rm(dir, { recursive: true, force: true });
});

test("serveStatic blocks path traversal attempts", async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), "static-"));
  await fs.writeFile(join(dir, "ok.txt"), "ok");

  const router = new Router();
  router.use(serveStatic(dir));
  router.use((_req, res) => { res.statusCode = 404; res.end("blocked"); });

  await withServer(router, async (base) => {
    const res = await fetch(base + "/../../etc/passwd");
    assert.equal(res.status, 404);
    assert.equal(await res.text(), "blocked");
  });

  await fs.rm(dir, { recursive: true, force: true });
});

// ---- compose ----

test("compose runs middleware in order and threads next()", async () => {
  const router = new Router();
  const order: string[] = [];
  const mw1 = ((_req, _res, next) => { order.push("a"); next(); }) as Parameters<typeof compose>[0];
  const mw2 = ((_req, _res, next) => { order.push("b"); next(); }) as Parameters<typeof compose>[0];
  router.get("/", compose(mw1, mw2), (_req, res) => {
    order.push("h");
    res.end("ok");
  });
  await withServer(router, async (base) => {
    const res = await fetch(base + "/");
    assert.equal(res.status, 200);
  });
  assert.deepEqual(order, ["a", "b", "h"]);
});

test("compose forwards thrown errors", async () => {
  const router = new Router();
  router.get("/", compose((() => { throw new Error("boom"); }) as Parameters<typeof compose>[0]));
  router.use((err, _req, res, _next) => {
    res.statusCode = 500;
    res.end((err as Error).message);
  });
  await withServer(router, async (base) => {
    const res = await fetch(base + "/");
    assert.equal(res.status, 500);
    assert.equal(await res.text(), "boom");
  });
});
