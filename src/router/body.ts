import type { IncomingMessage } from "http";
impt?: number;
  /**
   * Restrict parsing to a Content-Type. Defaults to the parser's natural type
   * (e.g. "application/json"). Matched against the media type only (the part
   * before any ";"), case-insensitively, so "application/json" also matches
   * "application/json; charset=utf-8" but not "application/json-patch+json".
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
  return makeParser(type, options.limit, (raw) =>
    raw.length === 0 ? undefined : raw,
  );
}

export function urlencoded(options: BodyOptions = {}): RouteHandler {
  const type = options.type ?? "application/x-www-form-urlencoded";
  return makeParser(type, options.limit, (raw) => {
    if (raw.length === 0) return undefined;
    const out: Record<string, string> = Object.create(null);
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
        let parsed: unknown;
        try {
          parsed = parse(raw);
        } catch {
          next(new BodyParseError("Invalid request body", 400));
          return;
        }
        req.body = parsed;
        next();
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
  if (typeof header !== "string") return false;
  const mediaType = header.split(";", 1)[0].trim().toLowerCase();
  return mediaType === wanted;
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      // Stop pulling data so an oversized upload can't keep buffering, while
      // leaving the socket intact so the error handler can still send a
      // response. pause() applies backpressure to the client.
      req.pause();
      reject(err);
    };
    // Reject early when the declared length already exceeds the limit, before
    // reading any of the body off the wire.
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > limit) {
      fail(new BodyParseError("Request body too large", 413));
      return;
    }
    req.on("data", (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (chunk.length > limit) {
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
