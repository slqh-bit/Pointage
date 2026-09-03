/**
 * Module planning — Plan §09 / P3.
 * Consultation hebdomadaire par service, saisie d'affectations,
 * expansion d'un roulement (cycle) sur une période.
 */
import { CycleApplySchema, ScheduleEntrySchema, ShiftTemplateSchema } from "@pointage/contracts";
import type { FastifyInstance } from "fastify";
import { expandCycle } from "../../engine/cycle.js";
import { authenticate, inScope, requireRole } from "../../plugins/auth.js";

export async function planningRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  // ── Gabarits de poste ────────────────────────────────────────────────────
  app.get("/api/v1/shift-templates", async () => {
    return app.prisma.shiftTemplate.findMany({ where: { isActive: true }, orderBy: { code: "asc" } });
  });

  app.post(
    "/api/v1/shift-templates",
    { preHandler: [requireRole("ADMIN", "DRH")] },
    async (req, reply) => {
      const parsed = ShiftTemplateSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues });
      const created = await app.prisma.shiftTemplate.create({ data: parsed.data });
      return reply.code(201).send(created);
    },
  );

  // ── Plannings hebdomadaires ──────────────────────────────────────────────
  app.get("/api/v1/schedules", async (req, reply) => {
    const q = req.query as { service?: string; week?: string };
    if (!q.service) return reply.code(400).send({ error: "service requis" });
    if (!inScope(req.auth!, q.service)) return reply.code(403).send({ error: "OUT_OF_SCOPE" });

    const weekStart = q.week ? new Date(q.week) : startOfWeek(new Date());
    const weekEnd = new Date(weekStart.getTime() + 7 * 86_400_000);

    const entries = await app.prisma.scheduleEntry.findMany({
      where: { serviceId: q.service, workDate: { gte: weekStart, lt: weekEnd } },
      include: { employee: { select: { id: true, matricule: true, firstName: true, lastName: true } }, shiftTemplate: true },
      orderBy: [{ workDate: "asc" }],
    });
    return reply.send({ weekStart, weekEnd, entries });
  });

  app.put(
    "/api/v1/schedules/:id",
    { preHandler: [requireRole("ADMIN", "DRH", "GESTIONNAIRE")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = ScheduleEntrySchema.partial().safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues });

      const existing = await app.prisma.scheduleEntry.findUnique({ where: { id } });
      if (!existing) return reply.code(404).send({ error: "NOT_FOUND" });
      if (existing.locked) {
        // §08 : changement rétroactif sur période clôturée = refusé, sauf
        // déverrouillage explicite tracé (endpoint period/unlock, P5).
        return reply.code(409).send({ error: "PERIOD_LOCKED" });
      }

      const updated = await app.prisma.scheduleEntry.update({
        where: { id },
        data: { ...parsed.data, origin: "EXPLICIT" },
      });
      return reply.send(updated);
    },
  );

  // ── Expansion d'un cycle sur une période ─────────────────────────────────
  app.post(
    "/api/v1/cycles/:id/apply",
    { preHandler: [requireRole("ADMIN", "DRH", "GESTIONNAIRE")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = CycleApplySchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues });
      const { employeeIds, from, to, anchorDate } = parsed.data;

      const cycle = await app.prisma.cycle.findUnique({ where: { id }, include: { steps: true } });
      if (!cycle) return reply.code(404).send({ error: "CYCLE_NOT_FOUND" });

      const expanded = expandCycle(cycle.steps, anchorDate, from, to);

      let created = 0;
      for (const employeeId of employeeIds) {
        const employee = await app.prisma.employee.findUnique({ where: { id: employeeId } });
        if (!employee) continue;
        for (const e of expanded) {
          // Ne jamais écraser une entrée verrouillée (période clôturée).
          const existing = await app.prisma.scheduleEntry.findUnique({
            where: { employeeId_workDate: { employeeId, workDate: e.workDate } },
          });
          if (existing?.locked) continue;
          await app.prisma.scheduleEntry.upsert({
            where: { employeeId_workDate: { employeeId, workDate: e.workDate } },
            update: { shiftTemplateId: e.shiftTemplateId, isRestDay: e.isRestDay, origin: "CYCLE" },
            create: {
              employeeId,
              serviceId: employee.serviceId,
              workDate: e.workDate,
              shiftTemplateId: e.shiftTemplateId,
              isRestDay: e.isRestDay,
              origin: "CYCLE",
              cycleId: cycle.id,
            },
          });
          created += 1;
        }
      }
      return reply.send({ applied: created, employees: employeeIds.length, from, to });
    },
  );
}

function startOfWeek(d: Date): Date {
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return new Date(day.getTime() - ((day.getDay() + 6) % 7) * 86_400_000); // lundi
}
