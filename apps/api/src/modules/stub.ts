/**
 * Module non encore implémenté : répond 501 en citant la phase du plan.
 * Rend la surface d'API (§09) visible et testable dès P1 sans prétendre
 * que le module existe.
 */
import type { FastifyInstance } from "fastify";

const PHASE_BY_MODULE: Record<string, string> = {
  planning: "P3 — Moteur de règles & planning (J15–J30)",
  absence: "P4 — Absences, heures sup., notifications (J25–J38)",
  report: "P5 — Tableaux de bord & rapports (J30–J42)",
  device: "P2 — Couche terminaux (J8–J20)",
  webhook: "P7 — Intégration & durcissement (J40–J50)",
};

export function stubModule(name: string, prefixes: string[]) {
  const phase = PHASE_BY_MODULE[name] ?? "phase à planifier";
  return async function routes(app: FastifyInstance): Promise<void> {
    for (const prefix of prefixes) {
      app.all(`${prefix}/*`, async (_req, reply) => {
        return reply.code(501).send({ error: "NOT_IMPLEMENTED", module: name, plannedPhase: phase });
      });
      app.all(prefix, async (_req, reply) => {
        return reply.code(501).send({ error: "NOT_IMPLEMENTED", module: name, plannedPhase: phase });
      });
    }
  };
}
