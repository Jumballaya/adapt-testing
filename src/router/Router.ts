import type { IncomingMessage, ServerResponse } from "node:http";
import {
  decorateRequest,
  decorateResponse,
  type Request,
  type Response,
} from "../http/index.ts";

export type NextFunction = (err?: unknown) => void;

export type RouteHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => void | Response | Promise<void | Response>;

export type ErrorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
) => void | Response | Promise<void | Response>;

export type Handler = RouteHandler | ErrorHandler;

export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

/**
 * @deprecated Use {@link Request} from "../http" instead.
 * Kept as an alias for backwards compatibility.
 */
export type RouterRequest = Request;

interface Layer {
  /** null method means "match any method" (middleware / mount). */
  method: HttpMethod | null;
  /** null pattern means "match every path" (root middleware). */
  pattern: RegExp | null;
  keys: string[];
  handler: Handler;
  /** Set when this layer mounts a sub-Router under a path prefix. */
  subRouter: Router | null;
  /** True for error-handling middleware (arity 4). */
  isErrorHandler: boolean;
}

/**
 * Small Express-style router written from scratch.
 *
 * Features:
 *   - HTTP method routes: get, post, put, patch, delete, head, options, all
 *   - Path parameters ("/users/:id") and wildcards ("/files/*")
 *   - Middleware chain via use() with next()
 *   - Sub-router mounting: parent.use("/api", apiRouter)
 *   - Error-handling middleware (handlers with 4 parameters)
 *   - Promise-returning handlers automatically forward rejections to next()
 *
 * Usage:
 *   const router = new Router();
 *   router.get("/", (req, res) => res.send("hi"));
 *   http.createServer(router.handle).listen(8080);
 */
export class Router {
  private layers: Layer[] = [];

  /** Bound entry point: `http.createServer(router.handle)`. */
  public readonly handle = (req: IncomingMessage, res: ServerResponse): void => {
    const request = decorateRequest(req);
    const response = decorateResponse(res);
    this.dispatch(request, response, (err) => {
      if (err) return this.defaultError(err, response);
      if (!response.writableEnded) {
        response.statusCode = 404;
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.end(`Cannot ${req.method} ${req.url}`);
      }
    });
  };

  // ---- Registration ----

  use(handler: Handler): this;
  use(path: string, ...handlers: Array<Handler | Router>): this;
  use(
    pathOrHandler: string | Handler,
    ...rest: Array<Handler | Router>
  ): this {
    if (typeof pathOrHandler === "function") {
      this.addMiddleware("/", pathOrHandler);
      return this;
    }
    for (const item of rest) {
      if (item instanceof Router) this.mount(pathOrHandler, item);
      else this.addMiddleware(pathOrHandler, item);
    }
    return this;
  }

  get(path: string, ...h: RouteHandler[]): this { return this.addRoute("GET", path, h); }
  post(path: string, ...h: RouteHandler[]): this { return this.addRoute("POST", path, h); }
  put(path: string, ...h: RouteHandler[]): this { return this.addRoute("PUT", path, h); }
  patch(path: string, ...h: RouteHandler[]): this { return this.addRoute("PATCH", path, h); }
  delete(path: string, ...h: RouteHandler[]): this { return this.addRoute("DELETE", path, h); }
  head(path: string, ...h: RouteHandler[]): this { return this.addRoute("HEAD", path, h); }
  options(path: string, ...h: RouteHandler[]): this { return this.addRoute("OPTIONS", path, h); }

  /** Match any HTTP method for the given path. */
  all(path: string, ...handlers: RouteHandler[]): this {
    const { pattern, keys } = compilePath(path, { end: true });
    for (const handler of handlers) {
      this.layers.push({
        method: null, pattern, keys, handler,
        subRouter: null, isErrorHandler: false,
      });
    }
    return this;
  }

  // ---- Internals ----

  private addRoute(method: HttpMethod, path: string, handlers: RouteHandler[]): this {
    const { pattern, keys } = compilePath(path, { end: true });
    for (const handler of handlers) {
      this.layers.push({
        method, pattern, keys, handler,
        subRouter: null, isErrorHandler: false,
      });
    }
    return this;
  }

  private addMiddleware(path: string, handler: Handler): void {
    const isRoot = path === "/" || path === "";
    const { pattern, keys } = isRoot
      ? { pattern: null, keys: [] }
      : compilePath(path, { end: false });
    this.layers.push({
      method: null, pattern, keys, handler,
      subRouter: null,
      isErrorHandler: handler.length === 4,
    });
  }

  private mount(path: string, router: Router): void {
    const isRoot = path === "/" || path === "";
    const { pattern, keys } = isRoot
      ? { pattern: null, keys: [] }
      : compilePath(path, { end: false });
    this.layers.push({
      method: null, pattern, keys,
      handler: router.handle as unknown as Handler,
      subRouter: router,
      isErrorHandler: false,
    });
  }

  /**
   * Walk the layer stack invoking matching handlers. Errors short-circuit
   * to the next error-handling middleware.
   */
  private dispatch(
    req: Request,
    res: Response,
    done: NextFunction,
    baseUrl = "",
  ): void {
    ensureRequestFields(req, baseUrl);

    const { pathname } = splitUrl(req.url ?? "/");
    const method = (req.method ?? "GET").toUpperCase() as HttpMethod;
    const relativePath = stripPrefix(pathname, baseUrl);
    let index = 0;

    const next: NextFunction = (err?: unknown) => {
      if (index >= this.layers.length) return done(err);
      const layer = this.layers[index++];

      if (err && !layer.isErrorHandler) return next(err);
      if (!err && layer.isErrorHandler) return next();
      if (layer.method && layer.method !== method) return next(err);

      const match = matchLayer(layer, relativePath);
      if (!match) return next(err);

      const previousParams = req.params;
      req.params = { ...previousParams, ...match.params };

      if (layer.subRouter) {
        const subBase = joinPaths(baseUrl, match.consumed);
        const previousBase = req.baseUrl;
        req.baseUrl = subBase;
        layer.subRouter.dispatch(req, res, (subErr) => {
          req.baseUrl = previousBase;
          req.params = previousParams;
          next(subErr);
        }, subBase);
        return;
      }

      try {
        const result = layer.isErrorHandler
          ? (layer.handler as ErrorHandler)(err, req, res, next)
          : (layer.handler as RouteHandler)(req, res, next);
        if (result && typeof (result as Promise<void>).then === "function") {
          (result as Promise<void>).catch(next);
        }
      } catch (thrown) {
        next(thrown);
      }
    };

    next();
  }

  private defaultError(err: unknown, res: Response): void {
    if (res.writableEnded) return;
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    res.end(message);
  }
}

// ---------- helpers ----------

function ensureRequestFields(req: Request, baseUrl: string): void {
  if (!req.params) req.params = {};
  if (!req.originalUrl) req.originalUrl = req.url ?? "/";
  if (req.baseUrl === undefined) req.baseUrl = baseUrl;
  const { pathname, query } = splitUrl(req.url ?? "/");
  req.path = pathname;
  req.query = query;
}

function splitUrl(url: string): {
  pathname: string;
  query: Record<string, string>;
} {
  const qIndex = url.indexOf("?");
  const pathname = qIndex === -1 ? url : url.slice(0, qIndex);
  const query: Record<string, string> = {};
  if (qIndex !== -1) {
    const params = new URLSearchParams(url.slice(qIndex + 1));
    for (const [k, v] of params) query[k] = v;
  }
  return { pathname: pathname || "/", query };
}

function stripPrefix(pathname: string, prefix: string): string {
  if (!prefix || prefix === "/") return pathname;
  if (pathname === prefix) return "/";
  if (pathname.startsWith(prefix + "/")) return pathname.slice(prefix.length);
  return pathname;
}

function joinPaths(a: string, b: string): string {
  if (!a || a === "/") return b || "/";
  if (!b || b === "/") return a;
  const left = a.endsWith("/") ? a.slice(0, -1) : a;
  const right = b.startsWith("/") ? b : "/" + b;
  return left + right;
}

interface MatchResult {
  params: Record<string, string>;
  consumed: string;
}

function matchLayer(layer: Layer, pathname: string): MatchResult | null {
  if (!layer.pattern) return { params: {}, consumed: "" };
  const m = layer.pattern.exec(pathname);
  if (!m) return null;
  const params: Record<string, string> = {};
  let wildIndex = 0;
  for (let i = 0; i < layer.keys.length; i++) {
    const key = layer.keys[i];
    const value = m[i + 1];
    if (value === undefined) continue;
    if (key === "*") params[String(wildIndex++)] = decodeParam(value);
    else params[key] = decodeParam(value);
  }
  return { params, consumed: m[0] === "/" ? "" : m[0] };
}

function decodeParam(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

/**
 * Compile an Express-style path ("/users/:id", "/files/*") into a RegExp
 * and an ordered list of param names.
 *
 *   end: true  -> must match the whole pathname (routes)
 *   end: false -> may match a prefix (middleware / mounts)
 */
function compilePath(
  path: string,
  opts: { end: boolean },
): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const escaped = path
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\/:([A-Za-z_][A-Za-z0-9_]*)/g, (_m, name: string) => {
      keys.push(name);
      return "/([^/]+)";
    })
    .replace(/\*/g, () => {
      keys.push("*");
      return "(.*)";
    });
  const suffix = opts.end ? "/?$" : "(?=/|$)";
  return { pattern: new RegExp("^" + escaped + suffix), keys };
}
