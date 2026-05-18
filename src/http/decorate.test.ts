import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { App } from "../app/App.ts";

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

test("res.status().json() sets status, content-type, and body", async () => {
  const app = new App();
  app.get("/", (_req, res) => {
    res.status(201).json({ created: true });
  });
  await withApp(app, async (base) => {
    const res = await fetch(base + "/");
    assert.equal(res.status, 201);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
    assert.deepEqual(await res.json(), { created: true });
  });
});

test("res.send() picks a content-type based on the body", async () => {
  const app = new App();
  app.get("/string", (_req, res) => res.send("<p>hi</p>"));
  app.get("/object", (_req, res) => res.send({ a: 1 }));
  app.get("/number", (_req, res) => res.send(42));
  app.get("/buffer", (_req, res) => res.send(Buffer.from("raw")));
  app.get("/empty", (_req, res) => res.send());

  await withApp(app, async (base) => {
    const str = await fetch(base + "/string");
    assert.equal(await str.text(), "<p>hi</p>");
    assert.match(str.headers.get("content-type") ?? "", /text\/html/);

    const obj = await fetch(base + "/object");
    assert.match(obj.headers.get("content-type") ?? "", /application\/json/);
    assert.deepEqual(await obj.json(), { a: 1 });

    const num = await fetch(base + "/number");
    assert.equal(await num.text(), "42");
    assert.match(num.headers.get("content-type") ?? "", /text\/plain/);

    const buf = await fetch(base + "/buffer");
    assert.match(buf.headers.get("content-type") ?? "", /application\/octet-stream/);
    assert.equal(await buf.text(), "raw");

    const empty = await fetch(base + "/empty");
    assert.equal(await empty.text(), "");
  });
});

test("res.type() accepts shorthand and full mime types", async () => {
  const app = new App();
  app.get("/short", (_req, res) => res.type("json").end('{"ok":true}'));
  app.get("/full", (_req, res) =>
    res.type("application/vnd.custom+json").end("{}"),
  );

  await withApp(app, async (base) => {
    const shortRes = await fetch(base + "/short");
    assert.match(shortRes.headers.get("content-type") ?? "", /application\/json/);

    const fullRes = await fetch(base + "/full");
    assert.equal(
      fullRes.headers.get("content-type"),
      "application/vnd.custom+json",
    );
  });
});

test("res.set()/header() set arbitrary headers and are chainable", async () => {
  const app = new App();
  app.get("/", (_req, res) => {
    res.set("X-One", "1").header("X-Two", "2").status(204).end();
  });
  await withApp(app, async (base) => {
    const res = await fetch(base + "/");
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("x-one"), "1");
    assert.equal(res.headers.get("x-two"), "2");
  });
});

test("res.redirect() defaults to 302 and accepts a status override", async () => {
  const app = new App();
  app.get("/temp", (_req, res) => res.redirect("/dest"));
  app.get("/perm", (_req, res) => res.redirect(301, "/forever"));

  await withApp(app, async (base) => {
    const temp = await fetch(base + "/temp", { redirect: "manual" });
    assert.equal(temp.status, 302);
    assert.equal(temp.headers.get("location"), "/dest");

    const perm = await fetch(base + "/perm", { redirect: "manual" });
    assert.equal(perm.status, 301);
    assert.equal(perm.headers.get("location"), "/forever");
  });
});

test("res.sendStatus() writes status code and default reason text", async () => {
  const app = new App();
  app.get("/", (_req, res) => res.sendStatus(404));
  await withApp(app, async (base) => {
    const res = await fetch(base + "/");
    assert.equal(res.status, 404);
    assert.equal(await res.text(), "Not Found");
  });
});

test("req.get()/header() return request headers case-insensitively", async () => {
  const app = new App();
  app.get("/", (req, res) => {
    res.json({
      lower: req.get("x-custom"),
      upper: req.header("X-CUSTOM"),
      missing: req.get("nope") ?? null,
    });
  });

  await withApp(app, async (base) => {
    const res = await fetch(base + "/", { headers: { "X-Custom": "value" } });
    assert.deepEqual(await res.json(), {
      lower: "value",
      upper: "value",
      missing: null,
    });
  });
});

test("req.get('set-cookie') returns the raw header array", async () => {
  // Most HTTP clients refuse to send Set-Cookie as a request header, so we
  // hand-craft the request via a raw TCP socket.
  const app = new App();
  app.get("/", (req, res) => {
    const cookies = req.get("set-cookie");
    res.json({ cookies: cookies ?? null, isArray: Array.isArray(cookies) });
  });
  await withApp(app, async (base) => {
    const url = new URL(base);
    const { default: net } = await import("node:net");
    const body: string = await new Promise((resolve, reject) => {
      const sock = net.createConnection(Number(url.port), url.hostname, () => {
        sock.write(
          "GET / HTTP/1.1\r\n" +
            `Host: ${url.host}\r\n` +
            "Set-Cookie: a=1\r\n" +
            "Set-Cookie: b=2\r\n" +
            "Connection: close\r\n\r\n",
        );
      });
      const chunks: Buffer[] = [];
      sock.on("data", (c) => chunks.push(c));
      sock.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      sock.on("error", reject);
    });
    const json = JSON.parse(body.slice(body.indexOf("\r\n\r\n") + 4));
    assert.equal(json.isArray, true);
    assert.deepEqual(json.cookies, ["a=1", "b=2"]);
  });
});

test("res.send() handles a raw Uint8Array as binary", async () => {
  const app = new App();
  app.get("/", (_req, res) => res.send(new Uint8Array([104, 105])));
  await withApp(app, async (base) => {
    const res = await fetch(base + "/");
    assert.match(res.headers.get("content-type") ?? "", /application\/octet-stream/);
    assert.equal(await res.text(), "hi");
  });
});

test("decorateRequest initializes routing fields on first decoration", async () => {
  const { decorateRequest } = await import("./decorate.ts");
  const raw = { headers: {}, url: "/foo?bar=1" } as unknown as Parameters<typeof decorateRequest>[0];
  const req = decorateRequest(raw);
  assert.deepEqual(req.params, {});
  assert.deepEqual(req.query, {});
  assert.equal(req.baseUrl, "");
  assert.equal(req.originalUrl, "/foo?bar=1");
  assert.equal(typeof req.get, "function");
  assert.equal(typeof req.header, "function");
});
