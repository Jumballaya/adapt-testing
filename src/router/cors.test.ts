import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Router } from "./Router.ts";
import { cors } from "./cors.ts";

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

test("reflects the request origin by default", async () => {
  const router = new Router();
  router.use(cors());
  router.get("/", (_req, res) => res.send("ok"));
  await withServer(router, async (base) => {
    const res = await fetch(base + "/", { headers: { Origin: "https://a.com" } });
    assert.equal(res.headers.get("access-control-allow-origin"), "https://a.com");
    assert.equal(res.headers.get("vary"), "Origin");
    assert.equal(await res.text(), "ok");
  });
});

test("answers a preflight request with 204 and no body", async () => {
  const router = new Router();
  router.use(cors());
  // No route handler for OPTIONS — the middleware must answer it.
  router.get("/", (_req, res) => res.send("ok"));
  await withServer(router, async (base) => {
    const res = await fetch(base + "/", {
      method: "OPTIONS",
      headers: {
        Origin: "https://a.com",
        "Access-Control-Request-Method": "GET",
      },
    });
    assert.equal(res.status, 204);
    assert.match(res.headers.get("access-control-allow-methods") ?? "", /GET/);
    assert.equal(await res.text(), "");
  });
});

test("reflects requested headers in preflight", async () => {
  const router = new Router();
  router.use(cors());
  await withServer(router, async (base) => {
    const res = await fetch(base + "/", {
      method: "OPTIONS",
      headers: {
        Origin: "https://a.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "X-Token, Content-Type",
      },
    });
    assert.equal(
      res.headers.get("access-control-allow-headers"),
      "X-Token, Content-Type",
    );
  });
});

test("an OPTIONS request without the preflight header is not intercepted", async () => {
  const router = new Router();
  router.use(cors());
  router.options("/", (_req, res) => res.send("real options"));
  await withServer(router, async (base) => {
    const res = await fetch(base + "/", {
      method: "OPTIONS",
      headers: { Origin: "https://a.com" },
    });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "real options");
  });
});

test("restricts to an allowed origin list", async () => {
  const router = new Router();
  router.use(cors({ origin: ["https://good.com"] }));
  router.get("/", (_req, res) => res.send("ok"));
  await withServer(router, async (base) => {
    const allowed = await fetch(base + "/", {
      headers: { Origin: "https://good.com" },
    });
    assert.equal(
      allowed.headers.get("access-control-allow-origin"),
      "https://good.com",
    );

    const denied = await fetch(base + "/", {
      headers: { Origin: "https://evil.com" },
    });
    assert.equal(denied.headers.get("access-control-allow-origin"), null);
    // The request itself still succeeds; the browser enforces the policy.
    assert.equal(await denied.text(), "ok");
  });
});

test("sets credentials and max-age when configured", async () => {
  const router = new Router();
  router.use(cors({ credentials: true, maxAge: 600 }));
  await withServer(router, async (base) => {
    const res = await fetch(base + "/", {
      method: "OPTIONS",
      headers: {
        Origin: "https://a.com",
        "Access-Control-Request-Method": "GET",
      },
    });
    assert.equal(res.headers.get("access-control-allow-credentials"), "true");
    assert.equal(res.headers.get("access-control-max-age"), "600");
  });
});

test("exposes headers to the browser when configured", async () => {
  const router = new Router();
  router.use(cors({ exposedHeaders: ["X-Total-Count", "X-Page"] }));
  router.get("/", (_req, res) => res.send("ok"));
  await withServer(router, async (base) => {
    const res = await fetch(base + "/", { headers: { Origin: "https://a.com" } });
    assert.equal(
      res.headers.get("access-control-expose-headers"),
      "X-Total-Count,X-Page",
    );
  });
});

test("a custom origin predicate decides per request", async () => {
  const router = new Router();
  router.use(cors({ origin: (o) => o.endsWith(".trusted.com") }));
  router.get("/", (_req, res) => res.send("ok"));
  await withServer(router, async (base) => {
    const ok = await fetch(base + "/", {
      headers: { Origin: "https://app.trusted.com" },
    });
    assert.equal(
      ok.headers.get("access-control-allow-origin"),
      "https://app.trusted.com",
    );
    const no = await fetch(base + "/", {
      headers: { Origin: "https://app.other.com" },
    });
    assert.equal(no.headers.get("access-control-allow-origin"), null);
  });
});
