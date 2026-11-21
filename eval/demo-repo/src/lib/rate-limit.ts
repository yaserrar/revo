/** Fixed-window, in-memory rate limiter (one web process). */
const windows = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (current.count >= max) return false;
  current.count++;
  return true;
}

/** Client address, from the header our load balancer sets (it overwrites any value the client sends). */
export function clientIp(req: Request): string {
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}
