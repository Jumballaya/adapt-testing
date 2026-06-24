import type { RouteHandler } from "./Router.ts";
import type { RouterResponse } from "./response.ts";

/**
 * HTTP Basic authentication middleware.
 *
 *   app.use(basicAuth({ alice: "s3cret" }));
 *
 * Checks the Authorization header against a { username: password } table. On
 * success req.user is set to the matched username and the request continues;
 * otherwise a 401 with a WWW-Authenticate challenge is returned.
 */
export function basicAuth(users: Record<string, string>): RouteHandler {
  return (req, res, next) => {
    const header = req.headers.authorization ?? "";
    if (!header.startsWith("Basic ")) {
      return challenge(res, "Authentication required");
    }

    const decoded = Buffer.from(header.slice(6), "base64").toString("utf-8");
    const sep = decoded.indexOf(":");
    const name = decoded.slice(0, sep);
    const password = decoded.slice(sep + 1);

    const expected = users[name];
    if (expected === undefined) {
      return challenge(res, "Unknown username");
    }
    if (expected !== password) {
      return challenge(res, "Incorrect password");
    }

    req.user = name;
    next();
  };
}

function challenge(res: RouterResponse, detail: string): void {
  res.statusCode = 401;
  res.setHeader("WWW-Authenticate", 'Basic realm="restricted"');
  res.end(detail);
}
