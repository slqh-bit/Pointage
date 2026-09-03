/**
 * Point d'entrée du serveur — Plan §03/§05.
 *
 * En production : Node tourne en Windows Service (NSSM) derrière IIS en
 * reverse proxy sur 443, avec le pare-feu, les certificats et la politique
 * de redémarrage gérés par l'unité informatique du CHU.
 */
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { startJobWorker } from "./lib/jobs.js";

const app = await buildApp();
const stopWorker = startJobWorker(app.prisma);
app.addHook("onClose", async () => stopWorker());

try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`API pointage-rabta à l'écoute sur ${config.host}:${config.port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
