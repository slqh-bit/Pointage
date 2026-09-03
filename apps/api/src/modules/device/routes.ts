/**
 * Module device — Plan §09 / P2.
 * Console terminaux : statut, dernier contact, stockage, sabotage,
 * alerte hors ligne ; provisionnement d'utilisateurs via le DeviceDriver.
 */
import { ZktecoDriver } from "@pointage/drivers";
import type { FastifyInstance } from "fastify";
import { authenticate, requireRole } from "../../plugins/auth.js";

/** Un terminal silencieux plus de 5 minutes lève une alerte (§06). */
const OFFLINE_AFTER_MS = 5 * 60_000;

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/api/v1/devices", async (_req, reply) => {
    const devices = await app.prisma.device.findMany({
      include: { site: { select: { code: true, nameFr: true } }, _count: { select: { enrollments: true } } },
      orderBy: { serialNumber: "asc" },
    });
    const now = Date.now();
    return reply.send({
      data: devices.map((d) => ({
        id: d.id,
        serialNumber: d.serialNumber,
        brand: d.brand,
        model: d.model,
        site: d.site,
        captureMode: d.captureMode,
        enrolledUsers: d._count.enrollments,
        lastSeenAt: d.lastSeenAt,
        online: d.lastSeenAt !== null && now - d.lastSeenAt.getTime() < OFFLINE_AFTER_MS,
        storageFreeKb: d.storageFreeKb,
        tamperState: d.tamperState,
      })),
    });
  });

  /** Pousse la liste des utilisateurs vers un terminal (file device_command ou pull direct). */
  app.post(
    "/api/v1/devices/:id/sync-users",
    { preHandler: [requireRole("ADMIN", "DRH")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const device = await app.prisma.device.findUnique({
        where: { id },
        include: { enrollments: { where: { isActive: true }, include: { employee: true } } },
      });
      if (!device) return reply.code(404).send({ error: "DEVICE_NOT_FOUND" });

      // Mode A (ADMS push) : la commande est mise en file, livrée au prochain ack.
      if (device.captureMode === "ADMS_PUSH") {
        const cmd = await app.prisma.deviceCommand.create({
          data: {
            deviceId: device.id,
            kind: "SYNC_USERS",
            payload: device.enrollments.map((e) => ({
              deviceUserId: e.deviceUserId,
              matricule: e.employee.matricule,
              fullName: `${e.employee.firstName} ${e.employee.lastName}`,
            })),
          },
        });
        return reply.code(202).send({ queued: true, commandId: cmd.id, users: device.enrollments.length });
      }

      // Mode B (pull) : push direct via le protocole ZK ouvert.
      if (!device.ipAddress) return reply.code(400).send({ error: "DEVICE_HAS_NO_IP" });
      const driver = new ZktecoDriver({ ip: device.ipAddress });
      const report = await driver.pushUsers(
        device.enrollments.map((e) => ({
          deviceUserId: e.deviceUserId,
          matricule: e.employee.matricule,
          fullName: `${e.employee.firstName} ${e.employee.lastName}`,
        })),
      );
      return reply.send({ queued: false, report });
    },
  );
}
