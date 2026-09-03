import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Router } from "../router/Router.ts";
import type { Handler, RouteHandler } from "../router/Router.ts";

export type ListenCallback = (info: { port: number; address: string }) => void;

/**
 * Express-style application built on top of Router.
 *
 * Wraps a root Router with an http.Server so you can register routes
 * and middleware directly on the app and then call listen() to start
 * accepting connections.
 *
 * Usage:
 *   const app = new App();
 *   app.use((req, _res, next) => { console.log(req.method, req.url); next(); });
 *   app.get("/", (_req, res) => res.end("hi"));
 *   app.listen(8080);
 */
export class App {
  private readonly router: Router;
  private s
  use(handler: Handler): this;
  use(path: string, ...handlers: Array<Handler | Router | App>): this;
  use(
    pathOrHandler: string | Handler,
    ...rest: Array<Handler | Router | App>
  ): this {
    if (typeof pathOrHandler === "function") {
      this.router.use(pathOrHandler);
      return this;
    }
    const unwrapped = rest.map((item) =>
      item instanceof App ? item.router : item,
    );
    this.router.use(pathOrHandler, ...unwrapped);
    return this;
  }

  // ---- HTTP method shortcuts ----

  get(path: string, ...h: RouteHandler[]): this { this.router.get(path, ...h); return this; }
  post(path: string, ...h: RouteHandler[]): this { this.router.post(path, ...h); return this; }
  put(path: string, ...h: RouteHandler[]): this { this.router.put(path, ...h); return this; }
  patch(path: string, ...h: RouteHandler[]): this { this.router.patch(path, ...h); return this; }
  delete(path: string, ...h: RouteHandler[]): this { this.router.delete(path, ...h); return this; }
  head(path: string, ...h: RouteHandler[]): this { this.router.head(path, ...h); return this; }
  options(path: string, ...h: RouteHandler[]): this { this.router.options(path, ...h); return this; }
  all(path: string, ...h: RouteHandler[]): this { this.router.all(path, ...h); return this; }

  // ---- Server lifecycle ----

  /** Bound request handler. Useful for embedding in an existing server. */
  public readonly handle = (req: IncomingMessage, res: ServerResponse): void => {
    this.router.handle(req, res);
  };

  /**
   * Start listening for connections.
   * Pass port 0 to let the OS choose a free port (handy for tests).
   */
  listen(port: number, callback?: ListenCallback): http.Server;
  listen(port: number, hostname: string, callback?: ListenCallback): http.Server;
  listen(
    port: number,
    hostnameOrCallback?: string | ListenCallback,
    maybeCallback?: ListenCallback,
  ): http.Server {
    if (this.server) {
      throw new Error("App is already listening");
    }

    const hostname =
      typeof hostnameOrCallback === "string" ? hostnameOrCallback : undefined;
    const callback =
      typeof hostnameOrCallback === "function"
        ? hostnameOrCallback
        : maybeCallback;

    const server = http.createServer(this.handle);
    this.server = server;

    const onListening = () => {
      const addr = server.address() as AddressInfo | null;
      if (callback && addr) {
        callback({ port: addr.port, address: addr.address });
      }
    };

    if (hostname) server.listen(port, hostname, onListening);
    else server.listen(port, onListening);

    return server;
  }

  /** Stop the server if it is running. Resolves once all connections close. */
  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) return resolve();
      this.server.close((err) => {
        this.server = null;
        if (err) reject(err);
        else resolve();
      });
    });
  }
}
