import 'server-only';
import {
  deliveryIds,
  InstallationEventSchema,
  InstallationRepositoriesEventSchema,
  PullRequestEventSchema,
} from '@revo/github';
import { logger } from '~/server/config/logger';
import { readBodyText, WEBHOOK_BODY_LIMIT } from '~/server/http/body';
import { toErrorResponse } from '~/server/http/error-response';
import { badRequest, HttpError } from '~/server/http/errors';
import { clientIp } from '~/server/http/client-ip';
import { assertRateLimit, RATE_LIMITS } from '~/server/http/rate-limit';
import { claimDelivery, finishDelivery } from './deliveries.service';
import { webhookVerifier } from './github-app';
import { handleInstallationEvent, handleInstallationRepositoriesEvent } from './installations.service';
import { handlePullRequestEvent } from './pull-requests.service';

async function dispatch(event: string, payload: unknown, deliveryId: string): Promise<string> {
  switch (event) {
    case 'pull_request':
      return handlePullRequestEvent(PullRequestEventSchema.parse(payload), deliveryId);
    case 'installation':
      return handleInstallationEvent(InstallationEventSchema.parse(payload), deliveryId);
    case 'installation_repositories':
      return handleInstallationRepositoriesEvent(
        InstallationRepositoriesEventSchema.parse(payload),
        deliveryId,
      );
    default:
      return 'ignored';
  }
}

/**
 * POST /api/github/webhook (spec 4, 6, 14). Not wrapped in route(): it needs
 * the raw body for the signature and never reads a session.
 * Rate limit → read at most 25 MB (413 above) → verify X-Hub-Signature-256
 * on the raw body (401 when invalid)
 * → log the delivery by X-GitHub-Delivery (a repeated delivery is a no-op)
 * → handle the event.
 */
export async function handleGithubWebhook(req: Request): Promise<Response> {
  try {
    const limit = RATE_LIMITS.webhook;
    assertRateLimit(`webhook:${clientIp(req)}`, limit.max, limit.windowMs);

    const verify = webhookVerifier();
    if (!verify) throw new HttpError(503, 'INTERNAL', 'Webhooks are not configured on this server.');
    const signature = req.headers.get('x-hub-signature-256');
    if (!signature || !/^sha256=[0-9a-f]{64}$/i.test(signature))
      throw new HttpError(401, 'UNAUTHORIZED', 'Invalid webhook signature.');
    // Bounded read: the signature is checked on the raw bytes, so the body is read first.
    const raw = await readBodyText(req, WEBHOOK_BODY_LIMIT);
    if (!(await verify(raw, signature)))
      throw new HttpError(401, 'UNAUTHORIZED', 'Invalid webhook signature.');

    const event = req.headers.get('x-github-event');
    const deliveryId = req.headers.get('x-github-delivery');
    if (!event || !deliveryId) throw badRequest('Missing X-GitHub-Event or X-GitHub-Delivery.');
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw badRequest('The payload is not JSON.');
    }
    if (event === 'ping') return Response.json({ ok: true, event });

    const action =
      typeof (payload as { action?: unknown }).action === 'string'
        ? (payload as { action: string }).action
        : null;
    const claimed = await claimDelivery({ deliveryId, event, action, ...deliveryIds(payload) });
    if (!claimed) {
      logger.info({ deliveryId, event, action }, 'webhook delivery already handled');
      return Response.json({ ok: true, duplicate: true });
    }

    try {
      const outcome = await dispatch(event, payload, deliveryId);
      await finishDelivery(deliveryId);
      logger.info({ deliveryId, event, action, outcome }, 'webhook handled');
      return Response.json({ ok: true, outcome });
    } catch (err) {
      await finishDelivery(deliveryId, err instanceof Error ? err.message : String(err)).catch(
        () => undefined,
      );
      throw err;
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
