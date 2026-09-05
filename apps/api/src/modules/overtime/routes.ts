/**
 * Module overtime — Plan §09 / P4.
 * Heures supplémentaires détectées par le moteur, validées par le Gestionnaire.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, inScope, requireRole } from "../../plugins/auth.js";

export async function overtimeRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/api/v1/overtime", async (req, reply) => {
    const q = req.query as { status?: string; service?: string };
    const rows = await app.prisma.overtimeRequest.findMany({
      where: {
        status: (q.status as never) ?? "PENDING",
        employee: q.service ? { serviceId: q.service } : undefined,
      },
      include: { employee: { select: { matricule: true, firstName: true, lastName: true } } },
      orderBy: { workDate: "desc" },
      take: 500,
    });
    return reply.send({ data: rows });
  });

  app.post(
    "/api/v1/overtime/:id/decision",
    { preHandler: [requireRole("ADMIN", "DRH", "GESTIONNAIRE")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const Body = z.object({
        decision: z.enum(["VALIDATED", "REJECTED"]),
        motif: z.string().max(500).optional(),
      });
      const parsed = Body.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues });

      const ot = await app.prisma.overtimeRequest.findUnique({
        where: { id },
        include: { employee: { select: { serviceId: true } } },
      });
      if (!ot) return reply.code(404).send({ error: "NOT_FOUND" });
      if (ot.status !== "PENDING") return reply.code(409).send({ error: "ALREADY_DECIDED" });
      if (!inScope(req.auth!, ot.employee.serviceId)) return reply.code(403).send({ error: "OUT_OF_SCOPE" });

      const updated = await app.prisma.overtimeRequest.update({
        where: { id },
        data: {
          status: parsed.data.decision,
          validatedById: req.auth!.sub,
          validatedAt: new Date(),
          motif: parsed.data.motif ?? null,
        },
      });
      return reply.send(updated);
    },
  );
}
