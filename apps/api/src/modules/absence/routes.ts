/**
 * Module absence — Plan §09 / P4.
 * Workflow demande → décision (approve | reject + motif), éclatement par jour
 * (absence_day — c'est contre cette table que le moteur joint, §07), soldes.
 */
import { AbsenceDecisionSchema, AbsenceRequestCreateSchema } from "@pointage/contracts";
import type { FastifyInstance } from "fastify";
import { authenticate, inScope, requireRole } from "../../plugins/auth.js";

const DAY_MS = 86_400_000;

export async function absenceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  /** L'agent soumet une demande (mobile-web, §11 P4 EXIT). */
  app.post("/api/v1/absences", async (req, reply) => {
    const parsed = AbsenceRequestCreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues });
    const data = parsed.data;
    if (data.endDate < data.startDate) {
      return reply.code(400).send({ error: "END_BEFORE_START" });
    }

    const [employee, type] = await Promise.all([
      app.prisma.employee.findUnique({ where: { id: data.employeeId } }),
      app.prisma.absenceType.findUnique({ where: { id: data.absenceTypeId } }),
    ]);
    if (!employee || !type) return reply.code(404).send({ error: "EMPLOYEE_OR_TYPE_NOT_FOUND" });

    const request = await app.prisma.absenceRequest.create({ data: { ...data, status: "PENDING" } });
    return reply.code(201).send(request);
  });

  /** Le chef de service approuve ou rejette, avec motif (§09). */
  app.post(
    "/api/v1/absences/:id/decision",
    { preHandler: [requireRole("ADMIN", "DRH", "GESTIONNAIRE", "SUPERVISEUR")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = AbsenceDecisionSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues });
      const { decision, motif } = parsed.data;

      const request = await app.prisma.absenceRequest.findUnique({
        where: { id },
        include: { absenceType: true, employee: true },
      });
      if (!request) return reply.code(404).send({ error: "NOT_FOUND" });
      if (!inScope(req.auth!, request.employee.serviceId)) {
        return reply.code(403).send({ error: "OUT_OF_SCOPE" });
      }
      if (request.status !== "PENDING") {
        return reply.code(409).send({ error: "ALREADY_DECIDED", status: request.status });
      }
      if (decision === "REJECTED" && !motif) {
        return reply.code(400).send({ error: "MOTIF_REQUIRED_ON_REJECTION" });
      }

      const updated = await app.prisma.$transaction(async (tx) => {
        const r = await tx.absenceRequest.update({
          where: { id },
          data: {
            status: decision,
            decidedById: req.auth!.sub,
            decidedAt: new Date(),
            decisionMotif: motif ?? null,
          },
        });

        if (decision === "APPROVED") {
          // Éclatement par jour — la forme contre laquelle le moteur joint (§07).
          const days: Array<{ absenceRequestId: string; employeeId: string; day: Date; fraction: number }> = [];
          for (let d = request.startDate.getTime(); d <= request.endDate.getTime(); d += DAY_MS) {
            const isStart = d === request.startDate.getTime();
            const isEnd = d === request.endDate.getTime();
            const fraction = (isStart && request.halfDayStart) || (isEnd && request.halfDayEnd) ? 0.5 : 1;
            days.push({ absenceRequestId: id, employeeId: request.employeeId, day: new Date(d), fraction });
          }
          await tx.absenceDay.createMany({ data: days, skipDuplicates: true });

          // Imputation sur le solde si le type compte (§08 : counted against balance).
          if (request.absenceType.countsAgainstBalance) {
            const year = request.startDate.getFullYear();
            const used = days.reduce((acc, x) => acc + x.fraction, 0);
            await tx.leaveBalance.upsert({
              where: {
                employeeId_absenceTypeId_year: {
                  employeeId: request.employeeId,
                  absenceTypeId: request.absenceTypeId,
                  year,
                },
              },
              update: { usedDays: { increment: used } },
              create: {
                employeeId: request.employeeId,
                absenceTypeId: request.absenceTypeId,
                year,
                entitledDays: 0,
                usedDays: used,
              },
            });
          }

          // Le recalcul day_result des jours touchés est déclenché via la file
          // de jobs (recalcul incrémental, §07).
          await tx.job.create({
            data: {
              kind: "RECOMPUTE_RANGE",
              payload: { employeeId: request.employeeId, from: request.startDate, to: request.endDate },
            },
          });
        }
        return r;
      });

      return reply.send(updated);
    },
  );

  app.get("/api/v1/absences", async (req, reply) => {
    const q = req.query as { status?: string; service?: string };
    const rows = await app.prisma.absenceRequest.findMany({
      where: {
        status: q.status as never,
        employee: q.service ? { serviceId: q.service } : undefined,
      },
      include: {
        employee: { select: { id: true, matricule: true, firstName: true, lastName: true } },
        absenceType: true,
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return reply.send({ data: rows });
  });

  /** Soldes par agent (§09). */
  app.get("/api/v1/balances/:employeeId", async (req, reply) => {
    const { employeeId } = req.params as { employeeId: string };
    const balances = await app.prisma.leaveBalance.findMany({
      where: { employeeId },
      include: { absenceType: true },
    });
    return reply.send({
      data: balances.map((b) => ({
        type: b.absenceType.code,
        year: b.year,
        entitled: Number(b.entitledDays),
        used: Number(b.usedDays),
        remaining: Number(b.entitledDays) - Number(b.usedDays),
      })),
    });
  });
}
