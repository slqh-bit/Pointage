/**
 * Module anomaly — Plan §08 / P4.
 * File d'anomalies avec résolution par le superviseur et traçabilité
 * complète des corrections (punch_correction lié à l'anomalie).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, inScope, requireRole } from "../../plugins/auth.js";

export async function anomalyRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  /** File d'attente des anomalies ouvertes. */
  app.get("/api/v1/anomalies", async (req, reply) => {
    const q = req.query as { status?: string; service?: string; from?: string; to?: string };
    if (q.service && !inScope(req.auth!, q.service)) {
      return reply.code(403).send({ error: "OUT_OF_SCOPE" });
    }
    const rows = await app.prisma.anomaly.findMany({
      where: {
        status: (q.status as never) ?? "OPEN",
        workDate: {
          gte: q.from ? new Date(q.from) : undefined,
          lte: q.to ? new Date(q.to) : undefined,
        },
        employee: q.service ? { serviceId: q.service } : undefined,
      },
      include: { employee: { select: { matricule: true, firstName: true, lastName: true, serviceId: true } } },
      orderBy: [{ workDate: "desc" }, { createdAt: "desc" }],
      take: 500,
    });
    return reply.send({ data: rows });
  });

  /**
   * Résolution : correction de pointage tracée (lien vers l'original + auteur)
   * ou rejet motivé. Puis recalcul du jour concerné (§07 incrémental).
   */
  app.post(
    "/api/v1/anomalies/:id/resolve",
    { preHandler: [requireRole("ADMIN", "DRH", "SUPERVISEUR")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const Body = z.object({
        action: z.enum(["CORRECT_PUNCH", "DISMISS"]),
        resolution: z.string().min(1).max(500),
        // Pour CORRECT_PUNCH : le pointage d'origine et l'heure corrigée.
        punchId: z.string().optional(),
        correctedTime: z.coerce.date().optional(),
      });
      const parsed = Body.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues });
      const body = parsed.data;

      const anomaly = await app.prisma.anomaly.findUnique({
        where: { id },
        include: { employee: { select: { serviceId: true } } },
      });
      if (!anomaly) return reply.code(404).send({ error: "NOT_FOUND" });
      if (anomaly.status !== "OPEN") return reply.code(409).send({ error: "ALREADY_RESOLVED" });
      if (!inScope(req.auth!, anomaly.employee.serviceId)) {
        return reply.code(403).send({ error: "OUT_OF_SCOPE" });
      }

      await app.prisma.$transaction(async (tx) => {
        if (body.action === "CORRECT_PUNCH") {
          if (!body.punchId || !body.correctedTime) {
            throw Object.assign(new Error("punchId et correctedTime requis"), { statusCode: 400 });
          }
          const punch = await tx.punch.findUnique({ where: { id: body.punchId } });
          if (!punch) throw Object.assign(new Error("PUNCH_NOT_FOUND"), { statusCode: 404 });
          // punch reste immuable : la correction est une nouvelle ligne liée (§06).
          await tx.punchCorrection.create({
            data: {
              punchId: punch.id,
              anomalyId: anomaly.id,
              correctedField: "punchedAt",
              correctedAt: new Date(),
              oldValue: punch.punchedAt.toISOString(),
              newValue: body.correctedTime.toISOString(),
              reason: body.resolution,
              correctedById: req.auth!.sub,
            },
          });
        }

        await tx.anomaly.update({
          where: { id },
          data: {
            status: body.action === "DISMISS" ? "DISMISSED" : "RESOLVED",
            resolvedById: req.auth!.sub,
            resolvedAt: new Date(),
            resolution: body.resolution,
          },
        });

        // Recalcul incrémental du jour touché.
        await tx.job.create({
          data: {
            kind: "RECOMPUTE_RANGE",
            payload: { employeeId: anomaly.employeeId, from: anomaly.workDate, to: anomaly.workDate },
          },
        });
      });

      return reply.send({ ok: true });
    },
  );
}
