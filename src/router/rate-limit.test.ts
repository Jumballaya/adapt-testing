import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Router } from "./Router.ts";
import { rateLimit } from "./rate-limit.ts";

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

test("allows a request under the limit and reports headers", async () => {
  const router = new Router();
  router.use(rateLimit({ max: 5 }));
  router.get("/", (_req, res) => res.send("ok"));
  await withServer(router, async (base) => {
    const res = await fetch(base + "/");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-ratelimit-limit"), "5");
    assert.equal(res.headers.get("x-ratelimit-remaining"), "4");
  });
});

test("returns 429 once the budget is used up", async () => {
  const router = new Router();
  router.use(rateLimit({ max: 2, message: "slow down" }));
  router.get("/", (_req, res) => res.send("ok"));
  await withServer(router, async (base) => {
    let last: Response | undefined;
    for (let i = 0; i < 6; i++) last = await fetch(base + "/");
    assert.equal(last!.status, 429);
    assert.equal(await last!.text(), "slow down");
    assert.ok(last!.headers.get("retry-after"));
  });
});

test("a fresh window lets requests through again", async () => {
  const router = new Router();
  router.use(rateLimit({ max: 2, windowMs: 50 }));
  router.get("/", (_req, res) => res.send("ok"));
  await withServer(router, async (base) => {
    for (let i = 0; i < 6; i++) await fetch(base + "/");
    await new Promise((r) => setTimeout(r, 70));
    const res = await fetch(base + "/");
    assert.equal(res.status, 200);
  });
});
