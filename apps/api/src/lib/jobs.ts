/**
 * Worker de jobs adossé à la base — Plan §03 : délibérément pas Redis.
 * Un service de moins à installer, surveiller et expliquer sur une machine
 * Windows d'hôpital. Poll la table job toutes les 5 s.
 *
 * Types de jobs :
 *   · RECOMPUTE_RANGE — recalcul incrémental day_result (§07)
 *   · REPORT_MONTHLY  — état mensuel (P5)
 *   · RECONCILE_PULL  — pull de réconciliation zklib-js (P2, mode B)
 */
import type { PrismaClient } from "@prisma/client";
import { recomputeRange } from "../engine/service.js";

const POLL_MS = 5_000;

export function startJobWorker(prisma: PrismaClient): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  async function tick(): Promise<void> {
    if (stopped) return;
    const job = await prisma.job.findFirst({
      where: { status: "QUEUED", runAt: { lte: new Date() } },
      orderBy: { runAt: "asc" },
    });
    if (!job) return;

    const claimed = await prisma.job.updateMany({
      where: { id: job.id, status: "QUEUED" },
      data: { status: "RUNNING", startedAt: new Date(), attempts: { increment: 1 } },
    });
    if (claimed.count === 0) return; // pris par un autre worker

    try {
      await runJob(prisma, job.kind, job.payload);
      await prisma.job.update({
        where: { id: job.id },
        data: { status: "DONE", finishedAt: new Date(), lastError: null },
      });
    } catch (err) {
      const exhausted = job.attempts + 1 >= job.maxAttempts;
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: exhausted ? "FAILED" : "QUEUED",
          lastError: String(err),
          // backoff simple : 30 s par tentative
          runAt: new Date(Date.now() + 30_000 * (job.attempts + 1)),
        },
      });
    }
  }

  async function loop(): Promise<void> {
    await tick().catch(() => undefined);
    if (!stopped) timer = setTimeout(() => void loop(), POLL_MS);
  }
  void loop();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

async function runJob(prisma: PrismaClient, kind: string, payload: unknown): Promise<void> {
  const p = (payload ?? {}) as Record<string, string>;
  switch (kind) {
    case "RECOMPUTE_RANGE": {
      const result = await recomputeRange(prisma, p["employeeId"]!, new Date(p["from"]!), new Date(p["to"]!));
      console.log(`RECOMPUTE_RANGE ${p["employeeId"]}: ${result.recomputed} jours (${result.skippedLocked} verrouillés)`);
      return;
    }
    case "REPORT_MONTHLY":
      // La génération de fichier est à la demande sur /reports/:jobId/export ;
      // le job matérialise la demande et sa traçabilité.
      return;
    case "RECONCILE_PULL":
      // P2 : pull de réconciliation via ZktecoDriver.pullEvents sur chaque
      // terminal en mode PULL — rebouche les trous du push ADMS (§06 mode B).
      return;
    default:
      throw new Error(`Type de job inconnu : ${kind}`);
  }
}
