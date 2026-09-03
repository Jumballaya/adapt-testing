import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { RouteHandler } from "./Router.ts";

/**
 * Serve files from a directory, in the style of express.static().
 *
 *   app.use(serveStatic("public"));            // mounted at the root
 *   app.use("/assets", assetsRouter);          // or under a prefix via a Router
 *
 * The request path (relative to the mount point) is resolved against root and
 * streamed via res.sendFile(). Requests that escape root, miss, or use a
 * non-GET/HEAD method fall through to the next handler so ordinary routing and
 * 404 handling still apply — unless fallthrough is disabled.
 */
export interface StaticOptions {
  /** File served for a directory request. Pass false to disable. Default "index.html". */
  index?: string | false;
  /**
   * When true (default) a miss calls next(); when false it ends the response
   * with 404 so no later handler can claim the path.
   */
  fallthrough?: boolean;
}

export function serveStatic(
  root: string,
  options: StaticOptions = {},
): RouteHandler {
  const rootDir = resolve(root);
  const index = options.index === undefined ? "index.html" : options.index;
  const fallthrough = options.fallthrough !== false;

  return async (req, res, next) => {
    const method = (req.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") return miss(next, res, fallthrough);

    const decoded = safeDecode(relativePath(req));
    if (decoded === null) return miss(next, res, fallthrough);

    // resolve() collapses any "../" segments; the prefix check then rejects
    // anything that still points outside root, defeating path traversal.
    const target = resolve(rootDir, "." + decoded);
    if (target !== rootDir && !target.startsWith(rootDir)) {
      return miss(next, res, fallthrough);
    }

    const file = await resolveFile(target, index);
    if (file === null) return miss(next, res, fallthrough);
    await res.sendFile(file);
  };
}

function miss(
  next: (err?: unknown) => void,
  res: { statusCode: number; end(body?: string): void },
  fallthrough: boolean,
): void {
  if (fallthrough) return next();
  res.statusCode = 404;
  res.end("Not Found");
}

/** Resolve a target to a concrete file path, applying the directory index. */
async function resolveFile(
  target: string,
  index: string | false,
): Promise<string | null> {
  const info = await stat(target).catch(() => null);
  if (info?.isFile()) return target;
  if (info?.isDirectory() && index) {
    const indeo = aw?.isFile()) return indexPath;
  }
  return null;
}

/** The request path with the router's mount prefix (baseUrl) removed. */
function relativePath(req: { path?: string; baseUrl?: string }): string {
  const base = req.baseUrl ?? "";
  const path = req.path ?? "/";
  if (base && path.startsWith(base)) return path.slice(base.length) || "/";
  return path;
}

function safeDecode(path: string): string | null {
  try {
    const decoded = decodeURIComponent(path);
    // A NUL byte can truncate the path inside lower-level filesystem calls.
    return decoded.includes("\0") ? null : decoded;
  } catch {
    return null;
  }
}
