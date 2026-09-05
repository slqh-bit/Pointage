/**
 * Module organisation — Plan §07 / P1.
 * Sites (25 blocs), services (35+), agents (3 000+), catégories.
 * Import RH depuis le fichier existant (matricule, service, catégorie) avec
 * rapport de validation : doublons et services orphelins remontés dès P1,
 * pas à l'UAT (§14 — risque qualité des données RH).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole } from "../../plugins/auth.js";

const EmployeeImportRow = z.object({
  matricule: z.string().min(1).max(20),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  serviceCode: z.string().min(1),
  categoryCode: z.string().min(1),
  email: z.string().email().optional(),
  hiredAt: z.coerce.date().optional(),
});

export async function organisationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  // ── Lecture ──────────────────────────────────────────────────────────────
  app.get("/api/v1/sites", async () => {
    return app.prisma.site.findMany({
      where: { isActive: true },
      include: { _count: { select: { services: true, devices: true } } },
      orderBy: { code: "asc" },
    });
  });

  app.get("/api/v1/services", async (req) => {
    const q = req.query as { site?: string };
    return app.prisma.service.findMany({
      where: { isActive: true, ...(q.site ? { siteId: q.site } : {}) },
      include: { site: { select: { code: true, nameFr: true } }, _count: { select: { employees: true } } },
      orderBy: { code: "asc" },
    });
  });

  app.get("/api/v1/employees", async (req) => {
    const q = req.query as { service?: string; q?: string };
    return app.prisma.employee.findMany({
      where: {
        isActive: true,
        ...(q.service ? { serviceId: q.service } : {}),
        ...(q.q
          ? {
              OR: [
                { matricule: { contains: q.q } },
                { firstName: { contains: q.q } },
                { lastName: { contains: q.q } },
              ],
            }
          : {}),
      },
      include: { service: { select: { code: true, nameFr: true } }, category: true },
      orderBy: [{ lastName: "asc" }],
      take: 200,
    });
  });

  // ── Administration ─────────────────────────────────────────────────────────
  app.post("/api/v1/sites", { preHandler: [requireRole("ADMIN")] }, async (req, reply) => {
    const Body = z.object({
      code: z.string().min(1).max(20),
      nameFr: z.string().min(1),
      nameAr: z.string().optional(),
      lat: z.number().optional(),
      lng: z.number().optional(),
      geofenceRadiusM: z.number().int().positive().optional(),
    });
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues });
    const site = await app.prisma.site.create({ data: parsed.data });
    return reply.code(201).send(site);
  });

  app.post("/api/v1/services", { preHandler: [requireRole("ADMIN")] }, async (req, reply) => {
    const Body = z.object({
      siteId: z.string().min(1),
      code: z.string().min(1).max(20),
      nameFr: z.string().min(1),
      nameAr: z.string().optional(),
    });
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues });
    const service = await app.prisma.service.create({ data: parsed.data });
    return reply.code(201).send(service);
  });

  /**
   * Import RH — P1 EXIT : un Administrateur importe les 3 000 agents.
   * Corps : tableau de lignes { matricule, firstName, lastName, serviceCode, categoryCode }.
   * Réponse : rapport de validation (importés, doublons, services inconnus,
   * catégories inconnues) — rien n'est absorbé silencieusement.
   */
  app.post(
    "/api/v1/employees/import",
    { preHandler: [requireRole("ADMIN", "DRH")] },
    async (req, reply) => {
      const Body = z.array(z.record(z.unknown())).min(1).max(10_000);
      const parsed = Body.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });

      const services = await app.prisma.service.findMany({ include: { site: true } });
      const categories = await app.prisma.employeeCategory.findMany();
      const serviceByCode = new Map(services.map((s) => [`${s.site.code}/${s.code}`, s]));
      // Alias pratique : code seul si non ambigu
      for (const s of services) {
        if (!serviceByCode.has(s.code)) serviceByCode.set(s.code, s);
      }
      const categoryByCode = new Map(categories.map((c) => [c.code, c]));

      const report = {
        total: parsed.data.length,
        imported: 0,
        duplicates: [] as string[],
        unknownServices: [] as string[],
        unknownCategories: [] as string[],
        invalid: [] as Array<{ line: number; reason: string }>,
      };

      const seen = new Set<string>();
      for (const [i, rawRow] of parsed.data.entries()) {
        const row = EmployeeImportRow.safeParse(rawRow);
        if (!row.success) {
          report.invalid.push({ line: i + 1, reason: row.error.issues[0]?.message ?? "ligne invalide" });
          continue;
        }
        const r = row.data;
        if (seen.has(r.matricule)) {
          report.duplicates.push(r.matricule);
          continue;
        }
        seen.add(r.matricule);

        const service = serviceByCode.get(r.serviceCode);
        if (!service) {
          report.unknownServices.push(`${r.matricule} → ${r.serviceCode}`);
          continue;
        }
        const category = categoryByCode.get(r.categoryCode);
        if (!category) {
          report.unknownCategories.push(`${r.matricule} → ${r.categoryCode}`);
          continue;
        }

        await app.prisma.employee.upsert({
          where: { matricule: r.matricule },
          update: {
            firstName: r.firstName,
            lastName: r.lastName,
            serviceId: service.id,
            categoryId: category.id,
            email: r.email ?? null,
            hiredAt: r.hiredAt ?? null,
          },
          create: {
            matricule: r.matricule,
            firstName: r.firstName,
            lastName: r.lastName,
            serviceId: service.id,
            categoryId: category.id,
            email: r.email ?? null,
            hiredAt: r.hiredAt ?? null,
          },
        });
        report.imported += 1;
      }

      return reply.send(report);
    },
  );
}
