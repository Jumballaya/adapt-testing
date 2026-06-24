import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Router } from "./Router.ts";
import {
  cookieParser,
  serializeCookie,
  parseCookieHeader,
} from "./cookies.ts";

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

// ---- pure functions ----

test("parseCookieHeader splits a header into a map", () => {
  assert.deepEqual({ ...parseCookieHeader("a=1; b=two; c=3") }, {
    a: "1",
    b: "two",
    c: "3",
  });
});

test("parseCookieHeader decodes percent-encoded values and strips quotes", () => {
  assert.deepEqual({ ...parseCookieHeader('name=%20ada%20; q="quoted"') }, {
    name: " ada ",
    q: "quoted",
  });
});

test("parseCookieHeader returns an empty map for undefined/empty headers", () => {
  assert.deepEqual({ ...parseCookieHeader(undefined) }, {});
  assert.deepEqual({ ...parseCookieHeader("") }, {});
});

test("parseCookieHeader keeps the first value for a duplicated name", () => {
  assert.equal(parseCookieHeader("x=first; x=second").x, "first");
});

test("serializeCookie encodes the value and defaults Path to /", () => {
  assert.equal(serializeCookie("sid", "a b"), "sid=a%20b; Path=/");
});

test("serializeCookie renders all supported attributes", () => {
  const str = serializeCookie("sid", "v", {
    path: "/admin",
    maxAge: 3600,
    domain: "example.com",
    httpOnly: true,
    secure: true,
    sameSite: "strict",
  });
  assert.equal(
    str,
    "sid=v; Path=/admin; Max-Age=3600; Domain=example.com; HttpOnly; Secure; SameSite=Strict",
  );
});

test("serializeCookie rejects invalid cookie names", () => {
  assert.throws(() => serializeCookie("bad name", "v"), /Invalid cookie name/);
});

// ---- middleware + response helpers ----

test("cookieParser populates req.cookies", async () => {
  const router = new Router();
  router.use(cookieParser());
  router.get("/", (req, res) => res.json(req.cookies));
  await withServer(router, async (base) => {
    const res = await fetch(base + "/", {
      headers: { Cookie: "session=abc; theme=dark" },
    });
    assert.deepEqual(await res.json(), { session: "abc", theme: "dark" });
  });
});

test("req.cookies is an empty map when no Cookie header is sent", async () => {
  const router = new Router();
  router.use(cookieParser());
  router.get("/", (req, res) => res.json({ keys: Object.keys(req.cookies!) }));
  await withServer(router, async (base) => {
    const res = await fetch(base + "/");
    assert.deepEqual(await res.json(), { keys: [] });
  });
});

test("res.cookie sets a Set-Cookie header", async () => {
  const router = new Router();
  router.get("/", (_req, res) => {
    res.cookie("sid", "xyz", { httpOnly: true }).send("ok");
  });
  await withServer(router, async (base) => {
    const res = await fetch(base + "/");
    const header = res.headers.get("set-cookie") ?? "";
    assert.match(header, /sid=xyz/);
    assert.match(header, /HttpOnly/);
    assert.match(header, /Path=\//);
  });
});

test("res.cookie can be called twice for two cookies", async () => {
  const router = new Router();
  router.get("/", (_req, res) => {
    res.cookie("a", "1").cookie("b", "2").send("ok");
  });
  await withServer(router, async (base) => {
    const res = await fetch(base + "/");
    // getSetCookie returns one entry per Set-Cookie header.
    const cookies = res.headers.getSetCookie();
    assert.equal(cookies.length, 2);
    assert.match(cookies[0], /^a=1/);
    assert.match(cookies[1], /^b=2/);
  });
});

test("res.clearCookie expires the cookie", async () => {
  const router = new Router();
  router.get("/", (_req, res) => res.clearCookie("sid").send("ok"));
  await withServer(router, async (base) => {
    const res = await fetch(base + "/");
    const header = res.headers.get("set-cookie") ?? "";
    assert.match(header, /sid=;/);
    assert.match(header, /Max-Age=0/);
    assert.match(header, /Expires=Thu, 01 Jan 1970/);
  });
});

test("a value round-trips through res.cookie and cookieParser", async () => {
  const setter = new Router();
  setter.get("/set", (_req, res) =>
    res.cookie("note", "a;b c=d").send("ok"),
  );
  const reader = new Router();
  reader.use(cookieParser());
  reader.get("/read", (req, res) => res.json({ note: req.cookies?.note }));

  await withServer(setter, async (setBase) => {
    const setRes = await fetch(setBase + "/set");
    const raw = setRes.headers.getSetCookie()[0];
    const value = raw.split(";", 1)[0]; // "note=a%3Bb%20c%3Dd"
    await withServer(reader, async (readBase) => {
      const res = await fetch(readBase + "/read", {
        headers: { Cookie: value },
      });
      assert.deepEqual(await res.json(), { note: "a;b c=d" });
    });
  });
});
