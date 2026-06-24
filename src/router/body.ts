import type { IncomingMessage } from "http";
import type { RouteHandler } from "./Router.ts";

/**
 * Built-in body-parsing middleware, in the style of express.json() /
 * express.urlencoded(). Each factory returns a middleware that reads the
 * request stream once, parses it according to the Content-Type, and assigns
 * the result to req.body before calling next().
 *
 *   app.use(json());
 *   app.post("/users", (req, res) => res.json(req.body));
 *
 * Requests whose Content-Type does not match a parser are passed through
 * untouched (req.body stays undefined), so several parsers can be stacked.
 * Malformed bodies and bodies over the size limit are forwarded to the error
 * chain via next(err) rather than throwing.
 */
export interface BodyOptions {
  /** Maximum body size in bytes. Defaults to 1 MiB. */
  limit?: number;
  /**
   * Restrict parsing to a Content-Type. Defaults to the parser's natural type
   * (e.g. "application/json"). Matched as a case-insensitive prefix, so
   * "application/json" also matches "application/json; charset=utf-8".
   */
  type?: string;
}

const DEFAULT_LIMIT = 1024 * 1024;

export function json(options: BodyOptions = {}): RouteHandler {
  const type = options.type ?? "application/json";
  return makeParser(type, options.limit, (raw) =>
    raw.length === 0 ? undefined : JSON.parse(raw),
  );
}

export function text(options: BodyOptions = {}): RouteHandler {
  const type = options.type ?? "text/plain";
  return makeParser(type, options.limit, (raw) => raw);
}

export function urlencoded(options: BodyOptions = {}): RouteHandler {
  const type = options.type ?? "application/x-www-form-urlencoded";
  return makeParser(type, options.limit, (raw) => {
    const out: Record<string, string> = {};
    for (const [k, v] of new URLSearchParams(raw)) out[k] = v;
    return out;
  });
}

function makeParser(
  type: string,
  limit: number = DEFAULT_LIMIT,
  parse: (raw: string) => unknown,
): RouteHandler {
  const wanted = type.toLowerCase();
  return (req, _res, next) => {
    if (!hasBody(req) || !contentTypeMatches(req, wanted)) return next();
    readBody(req, limit).then(
      (raw) => {
        try {
          req.body = parse(raw);
          next();
        } catch {
          next(new BodyParseError("Invalid request body", 400));
        }
      },
      (err) => next(err),
    );
  };
}

/** Thrown for malformed or oversized bodies; carries an HTTP status. */
export class BodyParseError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "BodyParseError";
    this.status = status;
  }
}

function hasBody(req: IncomingMessage): boolean {
  const method = (req.method ?? "GET").toUpperCase();
  return method !== "GET" && method !== "HEAD";
}

function contentTypeMatches(req: IncomingMessage, wanted: string): boolean {
  const header = req.headers["content-type"];
  return typeof header === "string" && header.toLowerCase().startsWith(wanted);
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    req.on("data", (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        fail(new BodyParseError("Request body too large", 413));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });
    req.on("error", fail);
  });
}
