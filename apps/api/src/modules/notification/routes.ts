/**
 * Module notification — Plan §08 / P4.
 * Centre de notifications in-app : pointage manqué, approbation en attente,
 * changement de planning, terminal hors ligne. L'envoi email est marqué
 * (emailedAt) par le worker quand SMTP est configuré.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../plugins/auth.js";

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/api/v1/notifications", async (req, reply) => {
    const q = req.query as { unread?: string };
    const rows = await app.prisma.notification.findMany({
      where: { userId: req.auth!.sub, ...(q.unread === "true" ? { readAt: null } : {}) },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return reply.send({ data: rows });
  });

  app.post("/api/v1/notifications/:id/read", async (req, reply) => {
    const { id } = req.params as { id: string };
    const updated = await app.prisma.notification.updateMany({
      where: { id, userId: req.auth!.sub },
      data: { readAt: new Date() },
    });
    if (updated.count === 0) return reply.code(404).send({ error: "NOT_FOUND" });
    return reply.send({ ok: true });
  });
}

/** Fabrique de notification — utilisée par les modules métier. */
export async function notify(
  app: FastifyInstance,
  userId: string,
  kind: string,
  title: string,
  body?: string,
  linkUrl?: string,
): Promise<void> {
  await app.prisma.notification.create({ data: { userId, kind, title, body: body ?? null, linkUrl: linkUrl ?? null } });
}

export const NotifyKinds = {
  MISSED_PUNCH: "MISSED_PUNCH",
  PENDING_APPROVAL: "PENDING_APPROVAL",
  PLANNING_CHANGE: "PLANNING_CHANGE",
  DEVICE_OFFLINE: "DEVICE_OFFLINE",
} as const satisfies Record<string, string>;

void z; // zod réservé pour les schémas de préférences de notification (T2)
