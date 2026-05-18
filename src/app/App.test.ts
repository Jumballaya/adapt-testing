import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { App } from "./App.ts";
import { Router } from "../router/Router.ts";

async function withApp<T>(
  app: App,
  fn: (base: string) => Promise<T>,
): Promise<T> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await app.close();
  }
}

test("app.get and app.listen serve a basic response", async () => {
  const app = new App();
  app.get("/", (_req, res) => res.end("hello"));
  await withApp(app, async (base) => {
    const res = await fetch(base + "/");
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "hello");
  });
});

test("app.use runs middleware before route handler", async () => {
  const app = new App();
  const calls: string[] = [];
  app.use((_req, _res, next) => { calls.push("mw"); next(); });
  app.get("/", (_req, res) => { calls.push("handler"); res.end("ok"); });
  await withApp(app, async (base) => {
    await fetch(base + "/");
    assert.deepEqual(calls, ["mw", "handler"]);
  });
});

test("app.use mounts a sub-Router under a path prefix", async () => {
  const app = new App();
  const api = new Router();
  api.get("/health", (_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  });
  app.use("/api", api);

  await withApp(app, async (base) => {
    const res = await fetch(base + "/api/health");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });
});

test("app.use mounts another App under a path prefix", async () => {
  const parent = new App();
  const child = new App();
  child.get("/ping", (_req, res) => res.end("pong"));
  parent.use("/nested", child);

  await withApp(parent, async (base) => {
    const res = await fetch(base + "/nested/ping");
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "pong");
  });
});

test("error-handling middleware catches thrown errors", async () => {
  const app = new App();
  app.get("/boom", () => { throw new Error("kaboom"); });
  app.use((err, _req, res, _next) => {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: (err as Error).message }));
  });

  await withApp(app, async (base) => {
    const res = await fetch(base + "/boom");
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: "kaboom" });
  });
});

test("listen() invokes the callback with the bound port", async () => {
  const app = new App();
  app.get("/", (_req, res) => res.end("ok"));
  const info = await new Promise<{ port: number; address: string }>((resolve) => {
    app.listen(0, (i) => resolve(i));
  });
  assert.ok(info.port > 0);
  await app.close();
});

test("calling listen twice throws", async () => {
  const app = new App();
  app.listen(0);
  assert.throws(() => app.listen(0), /already listening/);
  await app.close();
});

test("close() is a no-op when the app was never started", async () => {
  const app = new App();
  await app.close();
});
