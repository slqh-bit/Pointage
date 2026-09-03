/**
 * Types du moteur de règles — Plan §08.
 * Fonctions pures, fortement testées : c'est ici que l'argent de la
 * correction est dépensé (§03 — Tests).
 */
import type { AnomalyCode } from "@pointage/contracts";

/** Pointage normalisé à l'entrée du moteur. */
export interface EnginePunch {
  employeeId: string;
  punchedAt: Date;
  /** Site déduit du terminal ou du GPS — pour le drapeau OFF_SITE. */
  siteId?: string | null;
}

/** Gabarit de poste ramené à des minutes — forme de calcul pure. */
export interface ShiftSpec {
  /** Début du poste, minutes depuis minuit (ex. 08:00 → 480). */
  startMin: number;
  /** Fin du poste, minutes depuis minuit. */
  endMin: number;
  crossesMidnight: boolean;
  graceLateMin: number;
  graceEarlyLeaveMin: number;
  breakMin: number;
  breakDeducted: boolean;
}

/** Ce que le planning attend d'un agent pour un jour ouvré. */
export interface DayPlan {
  shift: ShiftSpec | null;
  siteId: string | null;
  isRestDay: boolean;
  /** Période clôturée : tout recalcul est refusé (§08, clôture mensuelle). */
  locked: boolean;
}

/** Recouvrement d'absence approuvée (étape 6 du pipeline). */
export interface AbsenceOverlay {
  coversDay: boolean;
  /** 1 = journée, 0.5 = demi-journée. */
  fraction: number;
}

/** Session entrée/sortie appariée (étape 3). */
export interface Session {
  inAt: Date;
  /** null = sortie manquante → anomalie, jamais heure inventée. */
  outAt: Date | null;
}

export interface DayComputation {
  theoreticalMin: number | null;
  /** null quand un pointage est non apparié — jour exclu de l'export paie. */
  workedMin: number | null;
  lateMin: number;
  earlyLeaveMin: number;
  overtimeMin: number;
  breakDeductedMin: number;
  flags: AnomalyCode[];
  sessions: Session[];
}

/** Recalcul refusé sur période verrouillée — déverrouillage explicite tracé. */
export class RecomputeRefusedError extends Error {
  constructor(public readonly workDate: Date) {
    super(
      `Recalcul refusé : la période du ${workDate.toISOString().slice(0, 10)} est clôturée. ` +
        "Déverrouillage explicite requis, enregistré au journal d'audit (§08).",
    );
    this.name = "RecomputeRefusedError";
  }
}
