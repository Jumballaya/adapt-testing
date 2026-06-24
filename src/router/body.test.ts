import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Router } from "./Router.ts";
import { json, text, urlencoded, BodyParseError } from "./body.ts";

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

/** Surface body-parse errors as a status code so tests can assert on them. */
function errorReporter(router: Router): void {
  router.use((err, _req, res, _next) => {
    const status = err instanceof BodyParseError ? err.status : 500;
    res.status(status).json({ error: (err as Error).message });
  });
}

test("json() parses a JSON body into req.body", async () => {
  const router = new Router();
  router.use(json());
  router.post("/", (req, res) => res.json(req.body));
  await withServer(router, async (base) => {
    const res = await fetch(base + "/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ a: 1, nested: { b: true } }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { a: 1, nested: { b: true } });
  });
});

test("json() leaves req.body undefined for an empty body", async () => {
  const router = new Router();
  router.use(json());
  router.post("/", (req, res) => res.json({ hasBody: req.body !== undefined }));
  await withServer(router, async (base) => {
    const res = await fetch(base + "/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    assert.deepEqual(await res.json(), { hasBody: false });
  });
});

test("json() forwards malformed JSON as a 400", async () => {
  const router = new Router();
  router.use(json());
  router.post("/", (req, res) => res.json(req.body));
  errorReporter(router);
  await withServer(router, async (base) => {
    const res = await fetch(base + "/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not valid",
    });
    assert.equal(res.status, 400);
  });
});

test("json() rejects bodies over the limit with a 413", async () => {
  const router = new Router();
  router.use(json({ limit: 8 }));
  router.post("/", (req, res) => res.json(req.body));
  errorReporter(router);
  await withServer(router, async (base) => {
    const res = await fetch(base + "/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "way too long" }),
    });
    assert.equal(res.status, 413);
  });
});

test("non-matching Content-Type passes through untouched", async () => {
  const router = new Router();
  router.use(json());
  router.post("/", (req, res) => res.json({ hasBody: req.body !== undefined }));
  await withServer(router, async (base) => {
    const res = await fetch(base + "/", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "plain text",
    });
    assert.deepEqual(await res.json(), { hasBody: false });
  });
});

test("urlencoded() parses form bodies into an object", async () => {
  const router = new Router();
  router.use(urlencoded());
  router.post("/", (req, res) => res.json(req.body));
  await withServer(router, async (base) => {
    const res = await fetch(base + "/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "name=ada&lang=js",
    });
    assert.deepEqual(await res.json(), { name: "ada", lang: "js" });
  });
});

test("text() exposes the raw body as a string", async () => {
  const router = new Router();
  router.use(text());
  router.post("/", (req, res) => res.send(req.body as string));
  await withServer(router, async (base) => {
    const res = await fetch(base + "/", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "hello body",
    });
    assert.equal(await res.text(), "hello body");
  });
});

test("stacked parsers each handle their own Content-Type", async () => {
  const router = new Router();
  router.use(json());
  router.use(urlencoded());
  router.post("/", (req, res) => res.json(req.body));
  await withServer(router, async (base) => {
    const asJson = await fetch(base + "/", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ from: "json" }),
    });
    assert.deepEqual(await asJson.json(), { from: "json" });

    const asForm = await fetch(base + "/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "from=form",
    });
    assert.deepEqual(await asForm.json(), { from: "form" });
  });
});

test("text()/urlencoded() leave req.body undefined for an empty body", async () => {
  const router = new Router();
  router.use(text());
  router.use(urlencoded());
  router.post("/", (req, res) => res.json({ hasBody: req.body !== undefined }));
  await withServer(router, async (base) => {
    const asText = await fetch(base + "/", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
    });
    assert.deepEqual(await asText.json(), { hasBody: false });

    const asForm = await fetch(base + "/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    assert.deepEqual(await asForm.json(), { hasBody: false });
  });
});

test("json() matches the media type strictly, not as a loose prefix", async () => {
  const router = new Router();
  router.use(json());
  router.post("/", (req, res) => res.json({ hasBody: req.body !== undefined }));
  await withServer(router, async (base) => {
    // application/json-patch+json shares the "application/json" prefix but is a
    // different media type and must not be parsed by json().
    const res = await fetch(base + "/", {
      method: "POST",
      headers: { "Content-Type": "application/json-patch+json" },
      body: JSON.stringify([{ op: "add", path: "/a", value: 1 }]),
    });
    assert.deepEqual(await res.json(), { hasBody: false });
  });
});

test("urlencoded() body has a null prototype (no __proto__ pollution)", async () => {
  const router = new Router();
  router.use(urlencoded());
  router.post("/", (req, res) =>
    res.json({ polluted: ({} as Record<string, unknown>).polluted ?? null }),
  );
  await withServer(router, async (base) => {
    await fetch(base + "/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "__proto__[polluted]=yes&a=1",
    });
    assert.deepEqual(({} as Record<string, unknown>).polluted ?? null, null);
  });
});
