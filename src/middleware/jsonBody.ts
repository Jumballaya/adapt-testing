import type { RouteHandler, RouterRequest } from "../router/index.ts";

export interface JsonBodyOptions {
  /** Max body size in bytes before the request is rejected with 413. */
  limit?: number;
  /** Content-types treated as JSON (matched by prefix). */
  types?: string[];
}

/**
 * JSON body parser middleware.
 *
 * Reads the request body and, when the Content-Type matches, parses it as
 * JSON and assigns the result to `req.body`. Non-matching requests pass
 * through untouched. On parse errors a 400 is returned; on oversize a 413.
 *
 *   router.use(jsonBody());
 *   router.post("/echo", (req, res) => res.end(JSON.stringify(req.body)));
 */
export function jsonBody(opts: JsonBodyOptions = {}): RouteHandler {
  const limit = opts.limit ?? 1_000_000;
  const types = opts.types ?? ["application/json"];

  return (req, res, next) => {
    const contentType = (req.headers["content-type"] ?? "")
      .toString()
      .toLowerCase();
    if (!types.some((t) => contentType.startsWith(t))) return next();

    let received = 0;
    const chunks: Buffer[] = [];
    let settled = false;

    req.on("data", (chunk: Buffer) => {
      if (settled) return;
      received += chunk.length;
      if (received > limit) {
        settled = true;
        res.statusCode = 413;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Payload Too Large");
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString("utf8");
      if (raw.length === 0) {
        (req as RouterRequest & { body: unknown }).body = undefined;
        return next();
      }
      try {
        (req as RouterRequest & { body: unknown }).body = JSON.parse(raw);
        next();
      } catch (err) {
        next(err);
      }
    });

    req.on("error", (err) => {
      if (settled) return;
      settled = true;
      next(err);
    });
  };
}
