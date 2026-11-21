/** BullMQ connection options from REDIS_URL (the URL's /N selects the Redis db). */
export function bullConnection(redisUrl: string) {
  return { url: redisUrl, maxRetriesPerRequest: null };
}
