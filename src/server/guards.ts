/**
 * Protects the unauthenticated local API from web pages the user happens to visit. Binding to
 * 127.0.0.1 does not stop a browser from reaching it, so two checks run on every request:
 * - Host: must name this machine, which defeats DNS rebinding.
 * - Origin: when a browser sends one it must match Host. Reading the body as text means a
 *   cross-site `text/plain` POST would otherwise work without any CORS preflight.
 */
import type { MiddlewareHandler } from 'hono';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Normalised host:port of a Host header or an origin, or null if it does not parse. */
function parseHost(value: string): URL | null {
  try {
    return new URL(value.includes('://') ? value : `http://${value}`);
  } catch {
    return null;
  }
}

export function requestGuard(allowedHosts: readonly string[] = []): MiddlewareHandler {
  const allowed = new Set(allowedHosts);
  return async (c, next) => {
    const host = parseHost(c.req.header('host') ?? new URL(c.req.url).host);
    if (!host || !(LOOPBACK.has(host.hostname) || allowed.has(host.hostname))) {
      return c.json({ error: 'this host is not allowed; set ALLOWED_HOSTS to serve other names', code: 'FORBIDDEN_HOST' }, 403);
    }
    const origin = c.req.header('origin');
    if (origin !== undefined && parseHost(origin)?.host !== host.host) {
      return c.json({ error: 'cross-origin requests are not allowed', code: 'FORBIDDEN_ORIGIN' }, 403);
    }
    return next();
  };
}
