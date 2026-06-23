import type { ServerResponse } from "http";

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
      : contentType;
    this.setHeader("Content-Type", value);
    return this;
  };

  r.json = function json(body: unknown): void {
    if (!this.hasHeader("Content-Type")) {
      this.setHeader("Content-Type", "application/json; charset=utf-8");
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

  return r;
}
