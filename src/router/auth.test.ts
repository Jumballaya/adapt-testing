import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Router } from "./Router.ts";
import { basicAuth } from "./auth.ts";

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

function basic(user: string, pass: string): string {
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

test("allows access with valid credentials and sets req.user", async () => {
  const router = new Router();
  router.use(basicAuth({ alice: "s3cret" }));
  router.get("/", (req, res) => res.send(`hi ${req.user}`));
  await withServer(router, async (base) => {
    const res = await fetch(base + "/", {
      headers: { Authorization: basic("alice", "s3cret") },
    });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "hi alice");
  });
});

test("challenges when no credentials are sent", async () => {
  const router = new Router();
  router.use(basicAuth({ alice: "s3cret" }));
  router.get("/", (_req, res) => res.send("secret"));
  await withServer(router, async (base) => {
    const res = await fetch(base + "/");
    assert.equal(res.status, 401);
    assert.match(res.headers.get("www-authenticate") ?? "", /Basic/);
  });
});

test("rejects a wrong password", async () => {
  const router = new Router();
  router.use(basicAuth({ alice: "s3cret" }));
  router.get("/", (_req, res) => res.send("secret"));
  await withServer(router, async (base) => {
    const res = await fetch(base + "/", {
      headers: { Authorization: basic("alice", "nope") },
    });
    assert.equal(res.status, 401);
  });
});
