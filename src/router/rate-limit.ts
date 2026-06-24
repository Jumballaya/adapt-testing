import type { IncomingMessage } from "http";
import type { RouteHandler } from "./Router.ts";

/**
 * Fixed-window in-memory rate limiter, in the style of express-rate-limit.
 *
 *   app.use(rateLimit({ windowMs: 60_000, max: 100 }));
 *
 * Each client is tracked by key (its address) with a request count that resets
 * once the current window elapses. Requests beyond the budget get a 429 with a
 * Retry-After header.
 */
export interface RateLimitOptions {
  /** Window length in milliseconds. Default 60_000 (1 minute). */
  windowMs?: number;
  /** Max requests allowed per window. Default 100. */
  max?: number;
  /** Body sent with the 429 response. */
  message?: string;
}

interface Counter {
  count: number;
  resetAt: number;
}

export function rateLimit(options: RateLimitOptions = {}): RouteHandler {
  const windowMs = options.windowMs ?? 60_000;
  const max = options.max ?? 100;
  const message = options.message ?? "Too Many Requests";
  const hits = new Map<string, Counter>();

  return (req, res, next) => {
    const key = clientKey(req);
    const now = Date.now();

    let entry = hits.get(key);
    if (!entry || now > entry.resetAt) {
      // A fresh window: counts are refreshed in place when the window rolls over.
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count++;

    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(max - entry.count));

    if (entry.count > max + 1) {
      res.statusCode = 429;
      res.setHeader("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
      res.end(message);
      return;
    }
    next();
  };
}

/** Identify the client a request came from. */
function clientKey(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}
