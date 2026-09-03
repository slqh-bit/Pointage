/**
 * Ingress ADMS — Plan §06, mode A (primaire).
 *
 * Les terminaux ZKTeco en firmware push POSTent leurs pointages en HTTP clair
 * vers /iclock/cdata. La connexion est sortante côté terminal : aucune règle
 * de pare-feu entrante par pointeuse.
 *
 * Invariants :
 *   · Idempotence sur (device, deviceUserId, punchedAt) — un retry ne crée
 *     jamais de doublon (contrainte unique punch_idempotency).
 *   · On répond par un ack + la file de commandes en attente, ce qui est
 *     aussi le canal qui pousse listes d'utilisateurs et commandes de porte.
 *   · Le pointage brut est écrit tel quel et jamais muté (§06 DESIGN RULE).
 */
import type { FastifyInstance } from "fastify";

/** Format ADMS : POST /iclock/cdata?SN=xxx&table=ATTLOG&Stamp=xxx — corps texte brut. */
export async function iclockRoutes(app: FastifyInstance): Promise<void> {
  app.addContentTypeParser("*", { parseAs: "string" }, (_req, body, done) => done(null, body));

  app.post("/iclock/cdata", async (req, reply) => {
    const query = req.query as Record<string, string>;
    const sn = query["SN"] ?? "";
    const table = query["table"] ?? "ATTLOG";

    const device = sn ? await app.prisma.device.findUnique({ where: { serialNumber: sn } }) : null;
    if (!device) {
      app.log.warn({ sn }, "iclock: terminal inconnu");
      return reply.code(200).type("text/plain").send("ERROR: unknown device");
    }

    await app.prisma.device.update({
      where: { id: device.id },
      data: { lastSeenAt: new Date() },
    });

    if (table === "ATTLOG" && typeof req.body === "string") {
      const lines = req.body.split(/\r?\n/).filter((l) => l.trim().length > 0);
      let inserted = 0;
      for (const line of lines) {
        // Format brut : pin \t date-heure \t statut \t vérification \t ...
        const [pin, ts] = line.split("\t");
        if (!pin || !ts) continue;
        const punchedAt = new Date(ts.replace(" ", "T"));
        if (Number.isNaN(punchedAt.getTime())) continue;

        const enrollment = await app.prisma.deviceEnrollment.findUnique({
          where: { deviceId_deviceUserId: { deviceId: device.id, deviceUserId: pin } },
        });

        try {
          await app.prisma.punch.create({
            data: {
              deviceId: device.id,
              deviceUserId: pin,
              employeeId: enrollment?.employeeId ?? null,
              punchedAt,
              source: "TERMINAL",
              rawPayload: { line, sn },
            },
          });
          inserted += 1;
        } catch (err: unknown) {
          // Contrainte punch_idempotency : retry ADMS → on ignore le doublon.
          if ((err as { code?: string }).code !== "P2002") throw err;
        }
      }
      app.log.info({ sn, inserted, received: lines.length }, "iclock: pointages ingérés");
    }

    // Ack + file de commandes sortantes (device_command, statut PENDING).
    const pending = await app.prisma.deviceCommand.findMany({
      where: { deviceId: device.id, status: "PENDING" },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
    if (pending.length > 0) {
      await app.prisma.deviceCommand.updateMany({
        where: { id: { in: pending.map((c) => c.id) } },
        data: { status: "DELIVERED", deliveredAt: new Date() },
      });
    }
    const commands = pending.map((c) => `C:${c.id}:${c.kind}`).join("\n");
    return reply.code(200).type("text/plain").send(commands.length > 0 ? `OK\n${commands}` : "OK");
  });

  /** GET /iclock/getrequest — le terminal interroge ses commandes en attente. */
  app.get("/iclock/getrequest", async (_req, reply) => {
    return reply.code(200).type("text/plain").send("OK");
  });
}
