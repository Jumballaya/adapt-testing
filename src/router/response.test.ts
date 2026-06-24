import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    // Drop idle keep-alive sockets so close() resolves promptly instead of
    // waiting out the keep-alive timeout.
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  }
}

test("res.status().json() sets the code, content-type, and body", async () => {
  const router = new Router();
  router.post("/users", (_req, res) => res.status(201).json({ id: 7 }));
  await withServer(router, async (base) => {
    const res = await fetch(base + "/users", { method: "POST" });
    assert.equal(res.status, 201);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
    assert.deepEqual(await res.json(), { id: 7 });
  });
});

test("res.send() infers JSON for objects", async () => {
  const router = new Router();
  router.get("/obj", (_req, res) => res.send({ ok: true }));
  await withServer(router, async (base) => {
    const res = await fetch(base + "/obj");
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
    assert.deepEqual(await res.json(), { ok: true });
  });
});

test("res.send() infers HTML for strings", async () => {
  const router = new Router();
  router.get("/html", (_req, res) => res.send("<b>hi</b>"));
  await withServer(router, async (base) => {
    const res = await fetch(base + "/html");
    assert.match(res.headers.get("content-type") ?? "", /text\/html/);
    assert.equal(await res.text(), "<b>hi</b>");
  });
});

test("res.send() with a Buffer defaults to octet-stream", async () => {
  const router = new Router();
  router.get("/buf", (_req, res) => res.send(Buffer.from("raw")));
  await withServer(router, async (base) => {
    const res = await fetch(base + "/buf");
    assert.match(
      res.headers.get("content-type") ?? "",
      /application\/octet-stream/,
    );
    assert.equal(await res.text(), "raw");
  });
});

test("res.type() adds a charset to bare types and respects full ones", async () => {
  const router = new Router();
  router.get("/csv", (_req, res) => res.type("text/csv").send("a,b"));
  router.get("/custom", (_req, res) =>
    res.type("text/plain; charset=latin1").send("x"),
  );
  await withServer(router, async (base) => {
    const csv = await fetch(base + "/csv");
    assert.equal(csv.headers.get("content-type"), "text/csv; charset=utf-8");
    const custom = await fetch(base + "/custom");
    assert.equal(custom.headers.get("content-type"), "text/plain; charset=latin1");
  });
});

test("explicit content-type is not overwritten by json()", async () => {
  const router = new Router();
  router.get("/jsonld", (_req, res) =>
    res.type("application/ld+json").json({ "@id": "1" }),
  );
  await withServer(router, async (base) => {
    const res = await fetch(base + "/jsonld");
    assert.equal(res.headers.get("content-type"), "application/ld+json; charset=utf-8");
    assert.deepEqual(await res.json(), { "@id": "1" });
  });
});

test("res.redirect() defaults to 302 with a Location header", async () => {
  const router = new Router();
  router.get("/old", (_req, res) => res.redirect("/new"));
  await withServer(router, async (base) => {
    const res = await fetch(base + "/old", { redirect: "manual" });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/new");
  });
});

test("res.redirect() accepts an explicit status", async () => {
  const router = new Router();
  router.get("/perm", (_req, res) => res.redirect(301, "/here"));
  await withServer(router, async (base) => {
    const res = await fetch(base + "/perm", { redirect: "manual" });
    assert.equal(res.status, 301);
    assert.equal(res.headers.get("location"), "/here");
  });
});

test("res.set() chains arbitrary headers", async () => {
  const router = new Router();
  router.get("/h", (_req, res) =>
    res.set("X-Custom", "yes").status(204).send(null),
  );
  await withServer(router, async (base) => {
    const res = await fetch(base + "/h");
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("x-custom"), "yes");
  });
});

test("helpers are available inside mounted sub-routers", async () => {
  const api = new Router();
  api.get("/ping", (_req, res) => res.json({ pong: true }));
  const router = new Router();
  router.use("/api", api);
  await withServer(router, async (base) => {
    const res = await fetch(base + "/api/ping");
    assert.deepEqual(await res.json(), { pong: true });
  });
});

/** Run `fn` with a throwaway directory that is removed afterward. */
async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "adapt-sendfile-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("res.sendFile streams a file with an inferred Content-Type", async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, "page.html");
    await writeFile(file, "<h1>hi</h1>");
    const router = new Router();
    router.get("/", (_req, res) => res.sendFile(file));
    await withServer(router, async (base) => {
      const res = await fetch(base + "/");
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type") ?? "", /text\/html/);
      assert.equal(res.headers.get("content-length"), "11");
      assert.equal(await res.text(), "<h1>hi</h1>");
    });
  });
});

test("res.sendFile uses octet-stream for unknown extensions", async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, "data.bin");
    await writeFile(file, "raw");
    const router = new Router();
    router.get("/", (_req, res) => res.sendFile(file));
    await withServer(router, async (base) => {
      const res = await fetch(base + "/");
      assert.match(
        res.headers.get("content-type") ?? "",
        /application\/octet-stream/,
      );
    });
  });
});

test("res.sendFile 404s a missing path without throwing", async () => {
  const router = new Router();
  router.get("/", (_req, res) => res.sendFile("/no/such/file.txt"));
  await withServer(router, async (base) => {
    const res = await fetch(base + "/");
    assert.equal(res.status, 404);
  });
});

test("res.sendFile 404s a directory rather than streaming it", async () => {
  await withTempDir(async (dir) => {
    const router = new Router();
    router.get("/", (_req, res) => res.sendFile(dir));
    await withServer(router, async (base) => {
      const res = await fetch(base + "/");
      assert.equal(res.status, 404);
    });
  });
});

test("res.sendFile respects a Content-Type set by the handler", async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, "weird.bin");
    await writeFile(file, "x");
    const router = new Router();
    router.get("/", (_req, res) => res.type("text/markdown").sendFile(file));
    await withServer(router, async (base) => {
      const res = await fetch(base + "/");
      assert.match(res.headers.get("content-type") ?? "", /text\/markdown/);
    });
  });
});

test("a handler that rejects after headers are sent does not crash the server", async () => {
  const router = new Router();
  router.get("/boom", async (_req, res) => {
    res.setHeader("Content-Length", "100");
    res.write("partial"); // flush headers, like a stream that started then failed
    throw new Error("read failed mid-stream");
  });
  router.get("/ok", (_req, res) => res.send("ok"));
  await withServer(router, async (base) => {
    // The failing request aborts; fetch sees a truncated/failed body.
    await fetch(base + "/boom").then((r) => r.text()).catch(() => {});
    // Crucially, the server is still alive and serving requests.
    const res = await fetch(base + "/ok");
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "ok");
  });
});
