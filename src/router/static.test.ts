import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { Router } from "./Router.ts";
import { serveStatic } from "./static.ts";

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
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  }
}

/** Build a throwaway public/ dir with a couple of fixtures. */
async function withPublicDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "adapt-static-"));
  await writeFile(join(dir, "style.css"), "body{color:red}");
  await writeFile(join(dir, "index.html"), "<h1>home</h1>");
  await mkdir(join(dir, "sub"));
  await writeFile(join(dir, "sub", "index.html"), "<h1>sub</h1>");
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("serves a file with the right Content-Type", async () => {
  await withPublicDir(async (dir) => {
    const router = new Router();
    router.use(serveStatic(dir));
    await withServer(router, async (base) => {
      const res = await fetch(base + "/style.css");
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type") ?? "", /text\/css/);
      assert.equal(await res.text(), "body{color:red}");
    });
  });
});

test("serves index.html for a directory request", async () => {
  await withPublicDir(async (dir) => {
    const router = new Router();
    router.use(serveStatic(dir));
    await withServer(router, async (base) => {
      const root = await fetch(base + "/");
      assert.equal(await root.text(), "<h1>home</h1>");
      const sub = await fetch(base + "/sub");
      assert.equal(await sub.text(), "<h1>sub</h1>");
    });
  });
});

test("falls through to the next handler on a miss", async () => {
  await withPublicDir(async (dir) => {
    const router = new Router();
    router.use(serveStatic(dir));
    router.get("/missing.txt", (_req, res) => res.send("from route"));
    await withServer(router, async (base) => {
      const res = await fetch(base + "/missing.txt");
      assert.equal(await res.text(), "from route");
    });
  });
});

test("rejects path traversal attempts", async () => {
  await withPublicDir(async (dir) => {
    // Put a secret one level above the served root.
    const secret = join(dir, "..", "secret.txt");
    await writeFile(secret, "TOP SECRET");
    try {
      const router = new Router();
      router.use(serveStatic(join(dir)));
      router.use((_req, res) => res.status(404).send("blocked"));
      await withServer(router, async (base) => {
        // %2e%2e%2f == "../" — must not escape the root.
        const res = await fetch(base + "/%2e%2e/secret.txt");
        assert.equal(res.status, 404);
        assert.equal(await res.text(), "blocked");
      });
    } finally {
      await rm(secret, { force: true });
    }
  });
});

test("fallthrough:false ends with a 404 on a miss", async () => {
  await withPublicDir(async (dir) => {
    const router = new Router();
    router.use(serveStatic(dir, { fallthrough: false }));
    router.get("/nope", (_req, res) => res.send("never reached"));
    await withServer(router, async (base) => {
      const res = await fetch(base + "/nope");
      assert.equal(res.status, 404);
    });
  });
});

test("index:false falls through for a directory request", async () => {
  await withPublicDir(async (dir) => {
    const router = new Router();
    router.use(serveStatic(dir, { index: false }));
    router.use((_req, res) => res.status(404).send("no index"));
    await withServer(router, async (base) => {
      const res = await fetch(base + "/");
      assert.equal(await res.text(), "no index");
    });
  });
});

test("ignores non-GET/HEAD methods", async () => {
  await withPublicDir(async (dir) => {
    const router = new Router();
    router.use(serveStatic(dir));
    router.post("/style.css", (_req, res) => res.send("posted"));
    await withServer(router, async (base) => {
      const res = await fetch(base + "/style.css", { method: "POST" });
      assert.equal(await res.text(), "posted");
    });
  });
});

test("serves files under a Router mount prefix", async () => {
  await withPublicDir(async (dir) => {
    const assets = new Router();
    assets.use(serveStatic(dir));
    const router = new Router();
    router.use("/assets", assets);
    await withServer(router, async (base) => {
      const res = await fetch(base + "/assets/style.css");
      assert.equal(res.status, 200);
      assert.equal(await res.text(), "body{color:red}");
    });
  });
});
