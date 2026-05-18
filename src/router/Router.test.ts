import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Router } from "./Router.ts";

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

test("routes GET / and returns the body", async () => {
  const router = new Router();
  router.get("/", (_req, res) => res.end("hello"));
  await withServer(router, async (base) => {
    const res = await fetch(base + "/");
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "hello");
  });
});

test("404s unknown routes", async () => {
  const router = new Router();
  router.get("/", (_req, res) => res.end("hi"));
  await withServer(router, async (base) => {
    const res = await fetch(base + "/nope");
    assert.equal(res.status, 404);
  });
});

test("returns 404 when method does not match", async () => {
  const router = new Router();
  router.get("/only-get", (_req, res) => res.end("ok"));
  await withServer(router, async (base) => {
    const res = await fetch(base + "/only-get", { method: "POST" });
    assert.equal(res.status, 404);
  });
});

test("extracts path parameters", async () => {
  const router = new Router();
  router.get("/users/:id/posts/:postId", (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(req.params));
  });
  await withServer(router, async (base) => {
    const res = await fetch(base + "/users/42/posts/abc");
    assert.deepEqual(await res.json(), { id: "42", postId: "abc" });
  });
});

test("parses the query string", async () => {
  const router = new Router();
  router.get("/q", (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(req.query));
  });
  await withServer(router, async (base) => {
    const res = await fetch(base + "/q?a=1&b=two");
    assert.deepEqual(await res.json(), { a: "1", b: "two" });
  });
});

test("middleware runs before route handler and can mutate state", async () => {
  const router = new Router();
  const calls: string[] = [];
  router.use((_req, _res, next) => { calls.push("mw1"); next(); });
  router.use((_req, _res, next) => { calls.push("mw2"); next(); });
  router.get("/", (_req, res) => { calls.push("handler"); res.end("ok"); });
  await withServer(router, async (base) => {
    await fetch(base + "/");
    assert.deepEqual(calls, ["mw1", "mw2", "handler"]);
  });
});

test("path-scoped middleware only runs for matching prefix", async () => {
  const router = new Router();
  let hit = 0;
  router.use("/admin", (_req, _res, next) => { hit++; next(); });
  router.get("/admin/dashboard", (_req, res) => res.end("dash"));
  router.get("/public", (_req, res) => res.end("pub"));
  await withServer(router, async (base) => {
    await fetch(base + "/public");
    assert.equal(hit, 0);
    await fetch(base + "/admin/dashboard");
    assert.equal(hit, 1);
  });
});

test("mounts a sub-router under a path prefix", async () => {
  const api = new Router();
  api.get("/users/:id", (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ id: req.params.id, baseUrl: req.baseUrl }));
  });
  const router = new Router();
  router.use("/api", api);

  await withServer(router, async (base) => {
    const res = await fetch(base + "/api/users/7");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { id: "7", baseUrl: "/api" });
  });
});

test("error middleware catches thrown errors", async () => {
  const router = new Router();
  router.get("/boom", () => { throw new Error("kapow"); });
  router.use((err, _req, res, _next) => {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: (err as Error).message }));
  });
  await withServer(router, async (base) => {
    const res = await fetch(base + "/boom");
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: "kapow" });
  });
});

test("forwards rejected promises to error middleware", async () => {
  const router = new Router();
  router.get("/async-boom", async () => {
    throw new Error("async kapow");
  });
  router.use((err, _req, res, _next) => {
    res.statusCode = 500;
    res.end((err as Error).message);
  });
  await withServer(router, async (base) => {
    const res = await fetch(base + "/async-boom");
    assert.equal(res.status, 500);
    assert.equal(await res.text(), "async kapow");
  });
});

test("wildcard captures the remainder as params[0]", async () => {
  const router = new Router();
  router.get("/files/*", (req, res) => {
    res.end(req.params["0"]);
  });
  await withServer(router, async (base) => {
    const res = await fetch(base + "/files/a/b/c.txt");
    assert.equal(await res.text(), "a/b/c.txt");
  });
});

test("all() matches any HTTP method", async () => {
  const router = new Router();
  router.all("/ping", (req, res) => res.end(req.method));
  await withServer(router, async (base) => {
    for (const method of ["GET", "POST", "PUT", "DELETE"]) {
      const res = await fetch(base + "/ping", { method });
      assert.equal(res.status, 200);
      if (method !== "HEAD") assert.equal(await res.text(), method);
    }
  });
});
