/**
 * Module webhook — Plan §09 / P7.
 * Abonnements : punch.created, absence.approved, device.offline.
 * Livraison signée HMAC-SHA256, retry via la file de jobs.
 */
import { randomBytes, createHmac } from "node:crypto";
import { WebhookSubscriptionSchema } from "@pointage/contracts";
import type { FastifyInstance } from "fastify";
import type { PrismaClient, Prisma } from "@prisma/client";
import { authenticate, requireRole } from "../../plugins/auth.js";

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.post(
    "/api/v1/webhooks",
    { preHandler: [requireRole("ADMIN", "DRH")] },
    async (req, reply) => {
      const parsed = WebhookSubscriptionSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues });
      const sub = await app.prisma.webhookSubscription.create({
        data: { ...parsed.data, secret: randomBytes(24).toString("hex") },
      });
      return reply.code(201).send(sub);
    },
  );

  app.get("/api/v1/webhooks", { preHandler: [requireRole("ADMIN", "DRH")] }, async () => {
    return app.prisma.webhookSubscription.findMany({
      select: { id: true, url: true, events: true, isActive: true, createdAt: true },
    });
  });

  app.delete("/api/v1/webhooks/:id", { preHandler: [requireRole("ADMIN", "DRH")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await app.prisma.webhookSubscription.update({ where: { id }, data: { isActive: false } });
    return reply.send({ ok: true });
  });
}

/**
 * Émet un événement vers tous les abonnés actifs. Chaque livraison est un
 * job WEBHOOK_DELIVER (retry + backoff déjà gérés par le worker §03).
 */
export async function emitWebhook(
  prisma: PrismaClient,
  event: "punch.created" | "absence.approved" | "device.offline",
  data: Prisma.InputJsonValue,
): Promise<void> {
  const subs = await prisma.webhookSubscription.findMany({ where: { isActive: true } });
  for (const sub of subs) {
    const events = sub.events as string[];
    if (!events.includes(event)) continue;
    await prisma.job.create({
      data: { kind: "WEBHOOK_DELIVER", payload: { subscriptionId: sub.id, event, data } },
    });
  }
}

/** Livraison effective — appelée par le worker de jobs. */
export async function deliverWebhook(
  prisma: PrismaClient,
  subscriptionId: string,
  event: string,
  data: unknown,
): Promise<void> {
  const sub = await prisma.webhookSubscription.findUnique({ where: { id: subscriptionId } });
  if (!sub || !sub.isActive) return;
  const payload = JSON.stringify({ event, data, emittedAt: new Date().toISOString() });
  const signature = createHmac("sha256", sub.secret).update(payload).digest("hex");
  const res = await fetch(sub.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-pointage-event": event,
      "x-pointage-signature": `sha256=${signature}`,
    },
    body: payload,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`webhook delivery failed: ${res.status}`);
}
