/**
 * Construction de l'application Fastify — séparée de server.ts pour les tests
 * (Supertest injecte sans ouvrir de port).
 */
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { config } from "./config.js";
import { createPrisma } from "./lib/prisma.js";
import { attendanceRoutes } from "./modules/attendance/routes.js";
import { authRoutes } from "./modules/auth/routes.js";
import { absenceRoutes } from "./modules/absence/routes.js";
import { iclockRoutes } from "./modules/device/iclock.routes.js";
import { deviceRoutes } from "./modules/device/routes.js";
import { planningRoutes } from "./modules/planning/routes.js";
import { stubModule } from "./modules/stub.js";

declare module "fastify" {
  interface FastifyInstance {
    prisma: ReturnType<typeof createPrisma>;
  }
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  await app.register(helmet);
  await app.register(cors, { origin: config.corsOrigin });
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" }); // durcissement P7

  const prisma = createPrisma();
  app.decorate("prisma", prisma);
  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });

  app.get("/health", async () => ({ status: "ok", service: "pointage-rabta-api" }));

  // Modules implémentés
  await app.register(authRoutes);
  await app.register(attendanceRoutes);
  await app.register(iclockRoutes);
  await app.register(planningRoutes);
  await app.register(absenceRoutes);
  await app.register(deviceRoutes);

  // Modules planifiés — surface d'API du §09, implémentée en P5/P7.
  await app.register(stubModule("report", ["/api/v1/day-results", "/api/v1/reports", "/api/v1/exports/payroll"]), { prefix: "" });
  await app.register(stubModule("webhook", ["/api/v1/webhooks"]), { prefix: "" });

  return app;
}
