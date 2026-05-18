import type { RouteHandler } from "../router/index.ts";

export interface LoggerOptions {
  /** Where to write the log line. Defaults to console.log. */
  write?: (line: string) => void;
  /** Override the clock; useful in tests. Returns milliseconds. */
  now?: () => number;
}

/**
 * Request logger middleware.
 *
 * Logs one line per request after the response finishes, including
 * method, URL, status code and elapsed milliseconds.
 *
 *   router.use(logger());
 */
export function logger(opts: LoggerOptions = {}): RouteHandler {
  const write = opts.write ?? ((line) => console.log(line));
  const now = opts.now ?? (() => Date.now());
  return (req, res, next) => {
    const start = now();
    res.on("finish", () => {
      const ms = now() - start;
      write(`${req.method} ${req.url} ${res.statusCode} ${ms}ms`);
    });
    next();
  };
}
