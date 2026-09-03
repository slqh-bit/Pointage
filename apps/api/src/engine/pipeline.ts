/**
 * Pipeline du moteur de règles — Plan §08, étapes 1 à 8.
 *
 *   1. Normalise   — déduplique les pointages dans une fenêtre configurable.
 *   2. Jour ouvré  — rattache chaque pointage à son jour métier (nuit ≠ calendrier).
 *   3. Apparie     — construit les sessions IN/OUT ; manquant = anomalie.
 *   4. Plan        — résolu par l'appelant (schedule_entry, sinon expansion cycle).
 *   5. Calcule     — travaillé, retard, départ anticipé, pauses, heures sup.
 *   6. Absences    — une absence approuvée remplace l'attente.
 *   7. Drapeaux    — MISSING_OUT, NO_PLAN, OFF_SITE, IMPOSSIBLE_TRANSITION…
 *   8. Persiste    — upsert day_result (hors de ces fonctions pures).
 *
 * Fonctions pures : pas d'I/O, pas d'horloge cachée. Tout est injecté.
 */
import type { AnomalyCode } from "@pointage/contracts";
import {
  RecomputeRefusedError,
  type AbsenceOverlay,
  type DayComputation,
  type DayPlan,
  type EnginePunch,
  type Session,
  type ShiftSpec,
} from "./types.js";

/** Étape 1 — deux pointages à moins de `windowMin` sont un seul événement. */
export function normalise(punches: EnginePunch[], windowMin = 2): EnginePunch[] {
  const sorted = [...punches].sort((a, b) => a.punchedAt.getTime() - b.punchedAt.getTime());
  const kept: EnginePunch[] = [];
  for (const p of sorted) {
    const last = kept[kept.length - 1];
    if (last && p.punchedAt.getTime() - last.punchedAt.getTime() < windowMin * 60_000) continue;
    kept.push(p);
  }
  return kept;
}

/** Date à minuit (UTC naïf jour civil) — clé de day_result. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function timeOfDayMin(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Étape 2 — jour ouvré d'un pointage. Pour un poste de nuit
 * (crossesMidnight), un pointage avant l'heure de début théorique
 * appartient au jour civil précédent : le poste 20:00 → 06:00 rattache
 * la sortie de 06:00 J2 au jour J1 (§08).
 */
export function resolveBusinessDay(punchedAt: Date, shift: ShiftSpec | null): Date {
  const day = startOfDay(punchedAt);
  if (shift?.crossesMidnight && timeOfDayMin(punchedAt) < shift.startMin) {
    return new Date(day.getTime() - 86_400_000);
  }
  return day;
}

/**
 * Étape 3 — appariement IN/OUT par ordre chronologique.
 * Un pointage impair termine une session sans sortie : signalé, pas deviné.
 */
export function pairSessions(punches: EnginePunch[]): Session[] {
  const sessions: Session[] = [];
  for (let i = 0; i < punches.length; i += 2) {
    const inPunch = punches[i];
    if (!inPunch) break;
    const outPunch = punches[i + 1];
    sessions.push({ inAt: inPunch.punchedAt, outAt: outPunch ? outPunch.punchedAt : null });
  }
  return sessions;
}

/** Bornes absolues du poste pour un jour ouvré donné. */
export function shiftBounds(workDate: Date, shift: ShiftSpec): { start: Date; end: Date } {
  const start = new Date(workDate.getTime() + shift.startMin * 60_000);
  const endMin = shift.crossesMidnight ? shift.endMin + 24 * 60 : shift.endMin;
  return { start, end: new Date(workDate.getTime() + endMin * 60_000) };
}

/** Durée théorique du poste en minutes (gère le passage à minuit). */
export function plannedMinutes(shift: ShiftSpec): number {
  const span = shift.crossesMidnight ? shift.endMin + 24 * 60 - shift.startMin : shift.endMin - shift.startMin;
  return shift.breakDeducted ? span - shift.breakMin : span;
}

const MS_PER_MIN = 60_000;

/**
 * Étapes 5 à 7 — calcul d'un jour ouvré complet.
 *
 * Invariants garantis :
 *   · période verrouillée → RecomputeRefusedError, jamais d'écrasement silencieux ;
 *   · absence approuvée → théorique préservé, travaillé = 0, aucune anomalie retard/absence ;
 *   · sortie manquante → workedMin null + MISSING_OUT (exclu de l'export paie) ;
 *   · pointage hors bloc affecté → enregistré + OFF_SITE, jamais rejeté silencieusement.
 */
export function computeDay(input: {
  employeeId: string;
  workDate: Date;
  punches: EnginePunch[];
  plan: DayPlan;
  absence: AbsenceOverlay | null;
  dedupWindowMin?: number;
  impossibleTransitionMin?: number;
}): DayComputation {
  const { plan, absence, workDate } = input;
  const windowMin = input.dedupWindowMin ?? 2;
  const impossibleMin = input.impossibleTransitionMin ?? 30;

  if (plan.locked) throw new RecomputeRefusedError(workDate);

  const flags = new Set<AnomalyCode>();
  const shift = plan.shift;
  const theoretical = shift ? plannedMinutes(shift) : null;

  // Étape 6 — recouvrement d'absence : l'attente est remplacée.
  if (absence?.coversDay) {
    return {
      theoreticalMin: theoretical,
      workedMin: 0,
      lateMin: 0,
      earlyLeaveMin: 0,
      overtimeMin: 0,
      breakDeductedMin: 0,
      flags: [],
      sessions: [],
    };
  }

  // Étapes 1-3
  const punches = normalise(input.punches, windowMin);
  const sessions = pairSessions(punches);

  if (punches.length > 0 && !shift && !plan.isRestDay) flags.add("NO_PLAN");

  const hasMissingOut = sessions.some((s) => s.outAt === null);
  if (hasMissingOut) flags.add("MISSING_OUT");

  // Transition impossible : deux sites distincts à moins de X minutes.
  for (let i = 1; i < punches.length; i++) {
    const prev = punches[i - 1];
    const curr = punches[i];
    if (
      prev?.siteId &&
      curr?.siteId &&
      prev.siteId !== curr.siteId &&
      curr.punchedAt.getTime() - prev.punchedAt.getTime() < impossibleMin * MS_PER_MIN
    ) {
      flags.add("IMPOSSIBLE_TRANSITION");
      break;
    }
  }

  // Hors bloc affecté : accepté et enregistré, signalé au superviseur.
  if (plan.siteId && punches.some((p) => p.siteId && p.siteId !== plan.siteId)) {
    flags.add("OFF_SITE");
  }

  // Étape 5 — minutes travaillées.
  let workedMin: number | null = null;
  if (sessions.length > 0 && !hasMissingOut) {
    workedMin = sessions.reduce((acc, s) => {
      // outAt non null garanti par hasMissingOut === false
      return acc + Math.round(((s.outAt as Date).getTime() - s.inAt.getTime()) / MS_PER_MIN);
    }, 0);
  }

  let lateMin = 0;
  let earlyLeaveMin = 0;
  let breakDeductedMin = 0;

  if (shift && sessions.length > 0) {
    const { start, end } = shiftBounds(workDate, shift);
    const firstIn = sessions[0]?.inAt;
    if (firstIn && firstIn.getTime() > start.getTime() + shift.graceLateMin * MS_PER_MIN) {
      lateMin = Math.round((firstIn.getTime() - start.getTime()) / MS_PER_MIN);
    }
    const lastOut = sessions[sessions.length - 1]?.outAt;
    if (lastOut && lastOut.getTime() < end.getTime() - shift.graceEarlyLeaveMin * MS_PER_MIN) {
      earlyLeaveMin = Math.round((end.getTime() - lastOut.getTime()) / MS_PER_MIN);
    }
    if (shift.breakDeducted && workedMin !== null && workedMin > 0) {
      breakDeductedMin = Math.min(shift.breakMin, workedMin);
      workedMin -= breakDeductedMin;
    }
  }

  // Heures supplémentaires au-delà de l'enveloppe planifiée.
  const overtimeMin =
    workedMin !== null && theoretical !== null ? Math.max(0, workedMin - theoretical) : 0;
  if (overtimeMin > 0) flags.add("OVERTIME_PENDING");

  return {
    theoreticalMin: theoretical,
    workedMin,
    lateMin,
    earlyLeaveMin,
    overtimeMin,
    breakDeductedMin,
    flags: [...flags],
    sessions,
  };
}
