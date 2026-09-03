/**
 * Service de recalcul day_result — Plan §07/§08, étape 8 du pipeline.
 *
 * Branche les fonctions pures du moteur sur la base :
 *   · recalcul incrémental quand un pointage, un planning ou une absence
 *     touchant la date change ;
 *   · reconstruction complète possible pour toute période depuis le brut —
 *     c'est aussi le scénario de reprise (§07 WHY DAY_RESULT EXISTS) ;
 *   · période verrouillée (clôture mensuelle) → recalcul refusé, sauf
 *     déverrouillage explicite tracé dans audit_log.
 */
import type { AnomalyCode, PrismaClient } from "@prisma/client";
import { computeDay } from "./pipeline.js";
import type { DayPlan, EnginePunch, ShiftSpec } from "./types.js";

const DAY_MS = 86_400_000;

type Db = Pick<PrismaClient, "punch" | "scheduleEntry" | "absenceDay" | "dayResult" | "anomaly" | "shiftTemplate">;

function toShiftSpec(t: {
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  graceLateMin: number;
  graceEarlyLeaveMin: number;
  breakMin: number;
  breakDeducted: boolean;
}): ShiftSpec {
  const [sh = 0, sm = 0] = t.startTime.split(":").map(Number);
  const [eh = 0, em = 0] = t.endTime.split(":").map(Number);
  return {
    startMin: sh * 60 + sm,
    endMin: eh * 60 + em,
    crossesMidnight: t.crossesMidnight,
    graceLateMin: t.graceLateMin,
    graceEarlyLeaveMin: t.graceEarlyLeaveMin,
    breakMin: t.breakMin,
    breakDeducted: t.breakDeducted,
  };
}

/**
 * Recalcule day_result pour un agent sur [from, to] inclus.
 * Retourne le nombre de jours recalculés et ceux refusés (verrouillés).
 */
export async function recomputeRange(
  prisma: Db,
  employeeId: string,
  from: Date,
  to: Date,
): Promise<{ recomputed: number; skippedLocked: number }> {
  const employee = await (prisma as PrismaClient).employee.findUniqueOrThrow({
    where: { id: employeeId },
    include: { service: true },
  });

  // Fenêtre élargie d'un jour : les sorties de poste de nuit du lendemain
  // se rattachent au jour ouvré précédent (§08, étape 2).
  const punches = await prisma.punch.findMany({
    where: { employeeId, punchedAt: { gte: from, lt: new Date(to.getTime() + 2 * DAY_MS) } },
    include: { device: { select: { siteId: true } } },
    orderBy: { punchedAt: "asc" },
  });
  const entries = await prisma.scheduleEntry.findMany({
    where: { employeeId, workDate: { gte: from, lte: to } },
    include: { shiftTemplate: true },
  });
  const absenceDays = await prisma.absenceDay.findMany({
    where: {
      employeeId,
      day: { gte: from, lte: to },
      absenceRequest: { status: "APPROVED" },
    },
  });

  let recomputed = 0;
  let skippedLocked = 0;

  for (let d = startOfDay(from).getTime(); d <= startOfDay(to).getTime(); d += DAY_MS) {
    const workDate = new Date(d);
    const entry = entries.find((e) => sameDay(e.workDate, workDate));
    const absence = absenceDays.find((a) => sameDay(a.day, workDate));

    const plan: DayPlan = {
      shift: entry?.shiftTemplate ? toShiftSpec(entry.shiftTemplate) : null,
      siteId: entry?.siteId ?? employee.service.siteId,
      isRestDay: entry?.isRestDay ?? false,
      locked: entry?.locked ?? false,
    };

    const dayPunches: EnginePunch[] = punches
      .filter((p) => {
        // Rattachement au jour ouvré via la règle du moteur (nuit → veille).
        const bd = plan.shift?.crossesMidnight && timeOfDayMin(p.punchedAt) < plan.shift.startMin
          ? new Date(startOfDay(p.punchedAt).getTime() - DAY_MS)
          : startOfDay(p.punchedAt);
        return sameDay(bd, workDate);
      })
      .map((p) => ({ employeeId, punchedAt: p.punchedAt, siteId: p.device?.siteId ?? null }));

    let result;
    try {
      result = computeDay({
        employeeId,
        workDate,
        punches: dayPunches,
        plan,
        absence: absence ? { coversDay: true, fraction: Number(absence.fraction) } : null,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "RecomputeRefusedError") {
        skippedLocked += 1;
        continue;
      }
      throw err;
    }

    // Ne pas persister une journée vide sans plan ni pointage ni absence.
    if (!entry && !absence && dayPunches.length === 0) continue;

    await prisma.dayResult.upsert({
      where: { employeeId_workDate: { employeeId, workDate } },
      update: {
        theoreticalMin: result.theoreticalMin,
        workedMin: result.workedMin,
        lateMin: result.lateMin,
        earlyLeaveMin: result.earlyLeaveMin,
        overtimeMin: result.overtimeMin,
        breakDeductedMin: result.breakDeductedMin,
        anomalyFlags: result.flags,
        absenceDayId: absence?.id ?? null,
        computedAt: new Date(),
      },
      create: {
        employeeId,
        workDate,
        theoreticalMin: result.theoreticalMin,
        workedMin: result.workedMin,
        lateMin: result.lateMin,
        earlyLeaveMin: result.earlyLeaveMin,
        overtimeMin: result.overtimeMin,
        breakDeductedMin: result.breakDeductedMin,
        anomalyFlags: result.flags,
        absenceDayId: absence?.id ?? null,
      },
    });

    // File d'anomalies (§08 étape 7) — résolues par le superviseur en P4.
    for (const code of result.flags) {
      await prisma.anomaly.upsert({
        where: { id: `auto-${employeeId}-${workDate.toISOString().slice(0, 10)}-${code}` },
        update: {},
        create: { id: `auto-${employeeId}-${workDate.toISOString().slice(0, 10)}-${code}`, employeeId, workDate, code: code as AnomalyCode },
      });
    }
    recomputed += 1;
  }

  return { recomputed, skippedLocked };
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function sameDay(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}
function timeOfDayMin(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}
