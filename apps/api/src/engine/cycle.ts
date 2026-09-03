/**
 * Expansion de cycles de roulement — Plan §08, étape 4.
 *
 * Quand aucune schedule_entry explicite n'existe, le jour ouvré est
 * résolu depuis le cycle de l'agent : dayIndex = (date - ancre) mod length.
 * Gère la semaine de bascule d'un roulement 3×8 par construction.
 */
export interface CycleStepSpec {
  dayIndex: number;
  /** null = jour de repos. */
  shiftTemplateId: string | null;
}

export interface ExpandedEntry {
  workDate: Date;
  shiftTemplateId: string | null;
  isRestDay: boolean;
}

const DAY_MS = 86_400_000;

export function expandCycle(
  steps: CycleStepSpec[],
  anchorDate: Date,
  from: Date,
  to: Date,
): ExpandedEntry[] {
  const length = steps.length;
  if (length === 0) throw new Error("Cycle vide : impossible d'étendre un roulement sans étapes.");
  const anchor = startOfUtcDay(anchorDate);
  const out: ExpandedEntry[] = [];
  for (let d = startOfUtcDay(from).getTime(); d <= startOfUtcDay(to).getTime(); d += DAY_MS) {
    // Modulo positif — les dates antérieures à l'ancre restent correctes.
    const idx = (((d - anchor.getTime()) / DAY_MS) % length + length) % length;
    const step = steps.find((s) => s.dayIndex === idx);
    if (!step) throw new Error(`Cycle incomplet : aucune étape au jour ${idx}.`);
    out.push({
      workDate: new Date(d),
      shiftTemplateId: step.shiftTemplateId,
      isRestDay: step.shiftTemplateId === null,
    });
  }
  return out;
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
