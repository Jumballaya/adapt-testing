import type { RouteHandler } from "./Router.ts";

/**
 * Cookie support, split the way Express splits it:
 *
 *   - cookieParser() middleware reads the incoming Cookie header and populates
 *     req.cookies (a plain { name: value } map).
 *   - res.cookie() / res.clearCookie() (see response.ts) write Set-Cookie
 *     headers using serializeCookie() below.
 *
 * Values are percent-encoded on the way out and decoded on the way in, so
 * arbitrary text round-trips safely.
 */
export interface CookieOptions {
  /** Lifetime in seconds, written as Max-Age. */
  maxAge?: number;
  /** Absolute expiry, written as Expires. */
  expires?: Date;
  /** Path scope. Defaults to "/". */
  path?: string;
  /** Domain scope. */
  domain?: string;
  /** Block JavaScript access (document.cookie). */
  httpOnly?: boolean;
  /** Only send over HTTPS. */
  secure?: boolean;
  /** Cross-site sending policy. */
  sameSite?: "strict" | "lax" | "none";
}

/** Parse a Cookie request header into a { name: value } map. */
export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    // First occurrence wins, matching how browsers resolve duplicate names.
    if (name in out) continue;
    out[name] = decodeCookieValue(part.slice(eq + 1).trim());
  }
  return out;
}

/** Serialize a single cookie into a Set-Cookie header value. */
export function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions = {},
): string {
  if (!FIELD_NAME.test(name)) {
    throw new TypeError(`Invalid cookie name: ${name}`);
  }
  let str = `${name}=${encodeURIComponent(value)}`;
  // Default Path to "/" so a cookie is returned for the whole origin, matching
  // Express; callers can still pass an explicit narrower path.
  str += `; Path=${options.path ?? "/"}`;
  if (options.maxAge !== undefined) {
    str += `; Max-Age=${Math.floor(options.maxAge)}`;
  }
  if (options.expires) str += `; Expires=${options.expires.toUTCString()}`;
  if (options.domain) str += `; Domain=${options.domain}`;
  if (options.httpOnly) str += "; HttpOnly";
  if (options.secure) str += "; Secure";
  if (options.sameSite) {
    str += `; SameSite=${capitalize(options.sameSite)}`;
  }
  return str;
}

/**
 * Middleware that parses the Cookie header into req.cookies. Idempotent and
 * cheap; if req.cookies is already set (e.g. by an outer router) it is left
 * untouched.
 */
export function cookieParser(): RouteHandler {
  return (req, _res, next) => {
    if (!req.cookies) {
      req.cookies = parseCookieHeader(req.headers.cookie);
    }
    next();
  };
}

// RFC 6265 cookie-name token: visible ASCII minus separators/control chars.
const FIELD_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function decodeCookieValue(raw: string): string {
  // Strip surrounding quotes some servers add, then percent-decode.
  const unquoted =
    raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')
      ? raw.slice(1, -1)
      : raw;
  try {
    return decodeURIComponent(unquoted);
  } catch {
    return unquoted;
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
