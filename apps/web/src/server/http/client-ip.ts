/**
 * The client's IP, for per-IP rate limits. Behind Cloudflare, every request
 * reaches the server from a Cloudflare edge address (shared by many clients),
 * and Cloudflare puts the real client in `cf-connecting-ip`, overwriting any
 * value the client sent. Without Cloudflare: the first X-Forwarded-For entry,
 * then X-Real-IP (set by the reverse proxy).
 */
export function clientIp(req: Pick<Request, 'headers'>): string {
  return (
    req.headers.get('cf-connecting-ip')?.trim() ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip')?.trim() ||
    'unknown'
  );
}
