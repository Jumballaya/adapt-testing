import type { RouteHandler } from "../router/index.ts";

export interface CorsOptions {
  /**
   * Allowed origin(s). A string, an array of strings, or a predicate.
   * Defaults to "*". When a function is provided and returns a string, that
   * value is echoed back; returning true echoes the request Origin.
   */
  origin?:
    | string
    | string[]
    | ((origin: string | undefined) => string | boolean);
  /** HTTP methods to advertise on preflight. */
  methods?: string[];
  /** Allowed request headers (preflight). */
  allowedHeaders?: string[];
  /** Response headers exposed to the browser. */
  exposedHeaders?: string[];
  /** Send Access-Control-Allow-Credentials: true. */
  credentials?: boolean;
  /** Access-Control-Max-Age in seconds. */
  maxAge?: number;
}

/**
 * CORS middleware.
 *
 * Sets the appropriate Access-Control-* headers and short-circuits
 * preflight (OPTIONS) requests with a 204.
 *
 *   router.use(cors({ origin: "https://example.com", credentials: true }));
 */
export function cors(opts: CorsOptions = {}): RouteHandler {
  const methods = opts.methods ?? ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"];
  return (req, res, next) => {
    const requestOrigin = req.headers.origin as string | undefined;
    const allowOrigin = resolveOrigin(opts.origin ?? "*", requestOrigin);
    if (allowOrigin !== null) {
      res.setHeader("Access-Control-Allow-Origin", allowOrigin);
      if (allowOrigin !== "*") res.setHeader("Vary", "Origin");
    }
    if (opts.credentials) {
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    if (opts.exposedHeaders?.length) {
      res.setHeader("Access-Control-Expose-Headers", opts.exposedHeaders.join(", "));
    }

    if ((req.method ?? "").toUpperCase() === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", methods.join(", "));
      const reqHeaders = req.headers["access-control-request-headers"];
      const allowed = opts.allowedHeaders?.join(", ")
        ?? (typeof reqHeaders === "string" ? reqHeaders : "");
      if (allowed) res.setHeader("Access-Control-Allow-Headers", allowed);
      if (opts.maxAge !== undefined) {
        res.setHeader("Access-Control-Max-Age", String(opts.maxAge));
      }
      res.statusCode = 204;
      res.setHeader("Content-Length", "0");
      res.end();
      return;
    }

    next();
  };
}

function resolveOrigin(
  setting: NonNullable<CorsOptions["origin"]>,
  requestOrigin: string | undefined,
): string | null {
  if (typeof setting === "string") return setting;
  if (Array.isArray(setting)) {
    if (requestOrigin && setting.includes(requestOrigin)) return requestOrigin;
    return null;
  }
  const result = setting(requestOrigin);
  if (result === true) return requestOrigin ?? null;
  if (result === false) return null;
  return result;
}
