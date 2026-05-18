import type { IncomingMessage, ServerResponse } from "node:http";
import type { Request, Response } from "./types.ts";

/**
 * Shorthand Content-Type values accepted by Response.type().
 * Anything not in this map is passed through as-is.
 */
const MIME_SHORTHANDS: Record<string, string> = {
  json: "application/json; charset=utf-8",
  html: "text/html; charset=utf-8",
  text: "text/plain; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  js: "application/javascript; charset=utf-8",
  bin: "application/octet-stream",
};

/**
 * Augment a raw IncomingMessage with the Request helpers.
 * Idempotent: safe to call multiple times on the same object.
 */
export function decorateRequest(raw: IncomingMessage): Request {
  const req = raw as Request;
  if (typeof req.header === "function") return req;

  const getHeader = function (this: Request, name: string): string | undefined {
    const value = this.headers[name.toLowerCase()];
    if (Array.isArray(value)) return value.join(", ");
    return value;
  };

  req.header = getHeader;
  req.get = getHeader;
  return req;
}

/**
 * Augment a raw ServerResponse with the Response helpers.
 * Idempotent: safe to call multiple times on the same object.
 */
export function decorateResponse(raw: ServerResponse): Response {
  const res = raw as Response;
  if (typeof res.json === "function") return res;

  res.status = function (this: Response, code: number): Response {
    this.statusCode = code;
    return this;
  };

  res.sendStatus = function (this: Response, code: number): Response {
    this.statusCode = code;
    this.setHeader("Content-Type", "text/plain; charset=utf-8");
    this.end(statusText(code));
    return this;
  };

  res.type = function (this: Response, mime: string): Response {
    const resolved = MIME_SHORTHANDS[mime] ?? mime;
    this.setHeader("Content-Type", resolved);
    return this;
  };

  res.set = function (
    this: Response,
    name: string,
    value: number | string | readonly string[],
  ): Response {
    this.setHeader(name, value as number | string | readonly string[]);
    return this;
  };
  res.header = res.set;

  res.json = function (this: Response, body: unknown): Response {
    if (!this.getHeader("Content-Type")) {
      this.setHeader("Content-Type", "application/json; charset=utf-8");
    }
    this.end(JSON.stringify(body));
    return this;
  };

  res.send = function (this: Response, body?: unknown): Response {
    if (body === undefined || body === null) {
      this.end();
      return this;
    }
    if (typeof body === "string") {
      if (!this.getHeader("Content-Type")) {
        this.setHeader("Content-Type", "text/html; charset=utf-8");
      }
      this.end(body);
      return this;
    }
    if (Buffer.isBuffer(body)) {
      if (!this.getHeader("Content-Type")) {
        this.setHeader("Content-Type", "application/octet-stream");
      }
      this.end(body);
      return this;
    }
    if (typeof body === "number" || typeof body === "boolean") {
      if (!this.getHeader("Content-Type")) {
        this.setHeader("Content-Type", "text/plain; charset=utf-8");
      }
      this.end(String(body));
      return this;
    }
    return this.json(body);
  };

  function redirect(this: Response, ...args: [string] | [number, string]): Response {
    const status = typeof args[0] === "number" ? args[0] : 302;
    const url = typeof args[0] === "number" ? args[1]! : args[0];
    this.statusCode = status;
    this.setHeader("Location", url);
    this.end();
    return this;
  }
  res.redirect = redirect as Response["redirect"];

  return res;
}

/**
 * Default reason phrase for a given status code.
 * Falls back to "Status <code>" when the code is unrecognized.
 */
function statusText(code: number): string {
  const TEXTS: Record<number, string> = {
    200: "OK",
    201: "Created",
    204: "No Content",
    301: "Moved Permanently",
    302: "Found",
    304: "Not Modified",
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    405: "Method Not Allowed",
    409: "Conflict",
    410: "Gone",
    418: "I'm a teapot",
    500: "Internal Server Error",
    501: "Not Implemented",
    502: "Bad Gateway",
    503: "Service Unavailable",
  };
  return TEXTS[code] ?? `Status ${code}`;
}
