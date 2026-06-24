import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { RouteHandler } from "./Router.ts";
import type { RouterResponse } from "./response.ts";

// Per-process key so the HMAC comparison below doesn't leak length or content
// of the configured passwords through timing.
const COMPARE_KEY = randomBytes(32);

/** Constant-time string comparison over fixed-length HMAC digests. */
function safeEqual(a: string, b: string): boolean {
  const ha = createHmac("sha256", COMPARE_KEY).update(a).digest();
  const hb = createHmac("sha256", COMPARE_KEY).update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * HTTP Basic authentication middleware.
 *
 *   app.use(basicAuth({ alice: "s3cret" }));
 *
 * Checks the Authorization header against a { username: password } table. On
 * success req.user is set to the matched username and the request continues;
 * otherwise a 401 with a WWW-Authenticate challenge is returned. Failures are
 * indistinguishable (same message, constant-time compare) to avoid leaking
 * which usernames exist.
 */
export function basicAuth(users: Record<string, string>): RouteHandler {
  return (req, res, next) => {
    const header = req.headers.authorization ?? "";
    if (!header.startsWith("Basic ")) {
      return challenge(res);
    }

    const decoded = Buffer.from(header.slice(6), "base64").toString("utf-8");
    const sep = decoded.indexOf(":");
    if (sep === -1) {
      return challenge(res);
    }

    const name = decoded.slice(0, sep);
    const password = decoded.slice(sep + 1);

    // Always run the comparison, even for unknown usernames, so the response
    // time does not reveal whether the username exists.
    const known = Object.prototype.hasOwnProperty.call(users, name);
    const expected = known ? users[name] : "";
    const match = safeEqual(expected, password);

    if (!known || !match) {
      return challenge(res);
    }

    req.user = name;
    next();
  };
}

function challenge(res: RouterResponse): void {
  res.statusCode = 401;
  res.setHeader("WWW-Authenticate", 'Basic realm="restricted"');
  res.end("Authentication required");
}
