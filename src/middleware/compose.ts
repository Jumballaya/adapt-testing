import type { RouteHandler, NextFunction } from "../router/index.ts";

/**
 * Compose multiple middleware functions into a single middleware that runs
 * them in order, threading next() through the chain.
 *
 *   router.get("/secure", compose(requireAuth, requireAdmin), handler);
 */
export function compose(...handlers: RouteHandler[]): RouteHandler {
  return (req, res, outerNext) => {
    let index = 0;
    const next: NextFunction = (err) => {
      if (err) return outerNext(err);
      if (index >= handlers.length) return outerNext();
      const handler = handlers[index++];
      try {
        const result = handler(req, res, next);
        if (result && typeof (result as Promise<void>).then === "function") {
          (result as Promise<void>).catch(outerNext);
        }
      } catch (thrown) {
        outerNext(thrown);
      }
    };
    next();
  };
}
