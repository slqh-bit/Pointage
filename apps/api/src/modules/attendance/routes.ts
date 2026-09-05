/**
 * Module attendance — POST/GET /api/v1/punches (Plan §09).
 * Pointage web / mobile avec géolocalisation et verdict de géorepérage.
 */
import { PunchCreateSchema } from "@pointage/contracts";
import type { FastifyInstance } from "fastify";
import { authenticate, inScope } from "../../plugins/auth.js";
import { emitWebhook } from "../webhook/routes.js";

export async function attendanceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.post("/api/v1/punches", async (req, reply) => {
    const parsed = PunchCreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues });
    const p = parsed.data;

    const employee = await app.prisma.employee.findUnique({
      where: { id: p.employeeId },
      include: { service: { include: { site: true } } },
    });
    if (!employee) return reply.code(404).send({ error: "EMPLOYEE_NOT_FOUND" });

    // Verdict géorepérage pour les pointages mobiles (P6).
    let geofenceOk: boolean | null = null;
    if (p.source === "MOBILE" && p.lat !== undefined && p.lng !== undefined) {
      const site = employee.service.site;
      if (site.lat !== null && site.lng !== null) {
        const distM = haversineM(p.lat, p.lng, Number(site.lat), Number(site.lng));
        geofenceOk = distM <= site.geofenceRadiusM;
      }
    }

    const punch = await app.prisma.punch.create({
      data: {
        employeeId: p.employeeId,
        punchedAt: p.punchedAt,
        source: p.source,
        verifyMode: p.verifyMode ?? (p.source === "MOBILE" ? "GPS_ONLY" : null),
        lat: p.lat,
        lng: p.lng,
        geofenceOk,
      },
    });

    // Événement webhook punch.created (§09) — livraison signée, retry via jobs.
    await emitWebhook(app.prisma, "punch.created", {
      id: punch.id,
      employeeId: punch.employeeId,
      punchedAt: punch.punchedAt,
      source: punch.source,
      geofenceOk: punch.geofenceOk,
    });

    return reply.code(201).send({ id: punch.id, geofenceOk });
  });

  app.get("/api/v1/punches", async (req, reply) => {
    const q = req.query as { from?: string; to?: string; service?: string };
    if (q.service && !inScope(req.auth!, q.service)) {
      return reply.code(403).send({ error: "OUT_OF_SCOPE" });
    }
    const punches = await app.prisma.punch.findMany({
      where: {
        punchedAt: {
          gte: q.from ? new Date(q.from) : undefined,
          lte: q.to ? new Date(q.to) : undefined,
        },
        employee: q.service ? { serviceId: q.service } : undefined,
      },
      orderBy: { punchedAt: "desc" },
      take: 500,
    });
    return reply.send({ data: punches });
  });
}

/** Distance haversine en mètres. */
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
