import { promises as fs } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { RouteHandler } from "../router/index.ts";

export interface ServeStaticOptions {
  /** File served when the request path is a directory. Defaults to "index.html". */
  index?: string | false;
  /** Override extension -> MIME type map. */
  mimeTypes?: Record<string, string>;
  /** Cache-Control header value. */
  cacheControl?: string;
}

const DEFAULT_MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * Static file serving middleware.
 *
 * Serves files under `root`. Path traversal (e.g. "..") is blocked.
 * Non-existent files fall through to the next middleware.
 *
 *   router.use("/assets", serveStatic("./public"));
 */
export function serveStatic(
  root: string,
  opts: ServeStaticOptions = {},
): RouteHandler {
  const absoluteRoot = resolve(root);
  const indexFile = opts.index === false ? null : (opts.index ?? "index.html");
  const mime = { ...DEFAULT_MIME, ...(opts.mimeTypes ?? {}) };

  return async (req, res, next) => {
    const method = (req.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") return next();

    const relative = decodeURIComponent(req.path ?? "/");
    const safe = normalize(relative).replace(/^([\\/]+)/, "");
    if (safe.split(sep).some((part) => part === "..")) return next();

    let filePath = join(absoluteRoot, safe);
    if (!filePath.startsWith(absoluteRoot)) return next();

    try {
      let stat = await fs.stat(filePath);
      if (stat.isDirectory()) {
        if (!indexFile) return next();
        filePath = join(filePath, indexFile);
        stat = await fs.stat(filePath);
      }
      if (!stat.isFile()) return next();

      const ext = extname(filePath).toLowerCase();
      res.setHeader("Content-Type", mime[ext] ?? "application/octet-stream");
      res.setHeader("Content-Length", String(stat.size));
      if (opts.cacheControl) res.setHeader("Cache-Control", opts.cacheControl);
      if (method === "HEAD") return res.end();

      const data = await fs.readFile(filePath);
      res.end(data);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") return next();
      next(err);
    }
  };
}
