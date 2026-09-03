import type { ServerResponse } from "http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { serializeCookie, type CookieOptions } from "./cookies.ts";

/**
 * Express-style response helpers layered onto Node's ServerResponse.
 *
 * These are chainable conveniences so handlers can write
 *
 *   res.status(201).json({ id });
 *
 * instead of the raw writeHead / JSON.stringify dance. The methods are added
 * once per response by enhanceResponse() before any handler runs, so they are
 * always present inside route handlers and middleware.
 */
export interface RouterResponse extends ServerResponse {
  /** Set the HTTP status code. Chainable. */
  status(code: number): this;
  /** Set a single response header. Chainable. */
  set(field: string, value: string): this;
  /** Set the Content-Type header. Bare types get a utf-8 charset. Chainable. */
  type(contentType: string): this;
  /** Send a JSON body (sets Content-Type unless already set) and end. */
  json(body: unknown): void;
  /** Send a string/Buffer/object body, inferring Content-Type, and end. */
  send(body: string | Buffer | object | null | undefined): void;
  /** Redirect to a URL. Defaults to 302; pass a status to override. */
  redirect(url: string): void;
  redirect(status: number, url: string): void;
  /** Queue a Set-Cookie header. Chainable. */
  cookie(name: string, value: string, options?: CookieOptions): this;
  /** Queue a Set-Cookie header that expires the named cookie. Chainable. */
  clearCookie(name: string, options?: CookieOptions): this;
  /**
   * Stream a file to the client, inferring Content-Type from its extension.
   * A path that is missing or not a regular file produces a 404 rather than
   * an error, so callers need no try/catch. Resolves once the response ends.
   */
  sendFile(path: string): Promise<void>;
}

const BARE_TYPE = /^[\w.+-]+\/[\w.+-]+$/;

/**
 * Attach the helper methods to a raw ServerResponse, in place. Idempotent:
 * a response that has already been enhanced is returned unchanged, so it is
 * safe to call on every request even when reused across sub-routers.
 */
export function enhanceResponse(res: ServerResponse): RouterResponse {
  const r = res as RouterResponse;
  if (typeof r.json === "function") return r;

  r.status = function status(code: number): RouterResponse {
    this.statusCode = code;
    return this;
  };

  r.set = function set(field: string, value: string): RouterResponse {
    this.setHeader(field, value);
    return this;
  };

  r.type = function type(contentType: string): RouterResponse {
    const value = BARE_TYPE.test(contentType)
      ? `${contentType}; charset=utf-8`
      : contensetHeader("Content-Type", "application/json; charset=utf-8");
    }
    this.end(JSON.stringify(body));
  };

  r.send = function send(
    body: string | Buffer | object | null | undefined,
  ): void {
    if (body === null || body === undefined) {
      this.end();
      return;
    }
    if (Buffer.isBuffer(body)) {
      if (!this.hasHeader("Content-Type")) {
        this.setHeader("Content-Type", "application/octet-stream");
      }
      this.end(body);
      return;
    }
    if (typeof body === "object") {
      this.json(body);
      return;
    }
    if (!this.hasHeader("Content-Type")) {
      this.setHeader("Content-Type", "text/html; charset=utf-8");
    }
    this.end(String(body));
  };

  r.redirect = function redirect(
    statusOrUrl: number | string,
    maybeUrl?: string,
  ): void {
    const code = typeof statusOrUrl === "number" ? statusOrUrl : 302;
    const url = typeof statusOrUrl === "number" ? maybeUrl! : statusOrUrl;
    this.statusCode = code;
    this.setHeader("Location", url);
    this.end();
  };

  r.cookie = function cookie(
    name: string,
    value: string,
    options?: CookieOptions,
  ): RouterResponse {
    this.appendHeader("Set-Cookie", serializeCookie(name, value, options));
    return this;
  };

  r.clearCookie = function clearCookie(
    name: string,
    options?: CookieOptions,
  ): RouterResponse {
    // Past expiry + empty value tells the browser to drop the cookie. Path and
    // Domain must match the original cookie, so callers pass them through.
    return this.cookie(name, "", { ...options, expires: EPOCH, maxAge: 0 });
  };

  r.sendFile = async function sendFile(path: string): Promise<void> {
    const info = await stat(path).catch(() => null);
    if (!info || !info.isFile()) {
      this.statusCode = 404;
      this.end("Not Found");
      return;
    }
    if (!this.hasHeader("Content-Type")) {
      this.setHeader("Content-Type", mimeForPath(path));
    }
    this.setHeader("Content-Length", String(info.size));
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(path);
      // Always release the file descriptor, including when the client
      // disconnects mid-transfer (response "close" before "finish").
      const cleanup = () => stream.destroy();
      this.on("close", cleanup);
      stream.on("error", (err) => {
        // Once headers/Content-Length are sent we can't switch to a 500, so
        // abort the socket instead of letting the rejection bubble to the
        // router's error handler (which would throw ERR_HTTP_HEADERS_SENT).
        if (this.headersSent) {
          this.destroy(err);
          resolve();
        } else {
          reject(err);
        }
      });
      this.on("error", reject);
      this.on("finish", resolve);
      stream.pipe(this);
    });
  };

  return r;
}

const EPOCH = new Date(0);

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function mimeForPath(path: string): string {
  return MIME_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}
