import type { RouteHandler } from "./Router.ts";

/**
 * Cross-Origin Resource Sharing middleware.
 *
 *   app.use(cors());                          // reflect any origin
 *   app.use(cors({ origin: "https://app.example.com", credentials: true }));
 *
 * Adds the appropriate Access-Control-* headers to every response and answers
 * CORS preflight requests (OPTIONS with an Access-Control-Request-Method
 * header) directly with 204, so they never reach route handlers.
 */
export interface CorsOptions {
  /**
   * Allowed origin(s). A string or list is matched against the request Origin;
   * "*" (the default) allows any. A predicate gives full control.
   */
  origin?: string | string[] | ((origin: string) => boolean);
  /** Methods advertised in preflight responses. Default: common verbs. */
  methods?: string[];
  /** Request headers allowed in preflight. Default: reflect what was asked. */
  allowedHeaders?: string[];
  /** Response headers the browser may expose to JS. */
  exposedHeaders?: string[];
  /** Allow credentials (cookies, auth headers). Default false. */
  credentials?: boolean;
  /** How long (seconds) a preflight result may be cached. */
  maxAge?: number;
}

const DEFAULT_METHODS = ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"];

export function cors(options: CorsOptions = {}): RouteHandler {
  const allowOrigin = originMatcher(options.origin ?? "*");
  const methods = (options.methods ?? DEFAULT_METHODS).join(",");

  return (req, res, next) => {
    const requestOrigin = req.headers.origin;
    const allowed =
      typeof requestOrigin === "string" && allowOrigin(requestOrigin);

    if (allowed) {
      // Echo the concrete origin (not "*") so the response stays valid when
      // credentials are enabled, and varies correctly in shared caches.
      res.setHeader("Access-Control-Allow-Origin", requestOrigin);
      res.setHeader("Vary", "Origin");
      if (options.credentials) {
        res.setHeader("Access-Control-Allow-Credentials", "true");
      }
      if (options.exposedHeaders?.length) {
        res.setHeader(
          "Access-Control-Expose-Headers",
          options.exposedHeaders.join(","),
        );
      }
    }

    if (!isPreflight(req)) return next();

    // Preflight: answer here so it never reaches a route handler.
    if (allowed) {
      res.setHeader("Access-Control-Allow-Methods", methods);
      const allowHeaders =
        options.allowedHeaders?.join(",") ??
        req.headers["access-control-request-headers"];
      if (allowHeaders) {
        res.setHeader("Access-Control-Allow-Headers", allowHeaders);
      }
      if (options.maxAge !== undefined) {
        res.setHeader("Access-Control-Max-Age", String(options.maxAge));
      }
    }
    res.end();
  };
}

function isPreflight(req: { method?: string; headers: Record<string, unknown> }): boolean {
  return req.headers["access-control-request-method"] !== undefined;
}

function originMatcher(
  origin: string | string[] | ((origin: string) => boolean),
): (requestOrigin: string) => boolean {
  if (typeof origin === "function") return origin;
  if (origin === "*") return () => true;
  if (Array.isArray(origin)) {
    const set = new Set(origin);
    return (requestOrigin) => set.has(requestOrigin);
  }
  return (requestOrigin) => requestOrigin === origin;
}
