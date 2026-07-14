import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { RouteHandler } from "./Router.ts";

veStatic(
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
    const indexPath = join(target, index);
    const indexInfo = await stat(indexPath).catch(() => null);
    if (indexInfo?.isFile()) return indexPath;
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
