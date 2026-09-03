/**
 * Les cas qui doivent être verts avant tout le reste — Plan §08.
 * Chaque test cite la ligne du tableau « Cases that must have tests ».
 */
import { describe, expect, it } from "vitest";
import { expandCycle } from "../cycle.js";
import {
  computeDay,
  normalise,
  pairSessions,
  resolveBusinessDay,
} from "../pipeline.js";
import { RecomputeRefusedError, type DayPlan, type ShiftSpec } from "../types.js";

const DAY = 86_400_000;
const J1 = new Date(2026, 5, 8); // lundi 08/06/2026
const at = (base: Date, h: number, m = 0) => new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m);

const garde24h: ShiftSpec = {
  startMin: 8 * 60,
  endMin: 8 * 60,
  crossesMidnight: true,
  graceLateMin: 10,
  graceEarlyLeaveMin: 10,
  breakMin: 0,
  breakDeducted: false,
};

const nuit: ShiftSpec = {
  startMin: 20 * 60,
  endMin: 6 * 60,
  crossesMidnight: true,
  graceLateMin: 10,
  graceEarlyLeaveMin: 10,
  breakMin: 30,
  breakDeducted: true,
};

const journee: ShiftSpec = {
  startMin: 8 * 60,
  endMin: 17 * 60,
  crossesMidnight: false,
  graceLateMin: 10,
  graceEarlyLeaveMin: 10,
  breakMin: 45,
  breakDeducted: true,
};

const plan = (shift: ShiftSpec | null, extra: Partial<DayPlan> = {}): DayPlan => ({
  shift,
  siteId: "bloc-a",
  isRestDay: false,
  locked: false,
  ...extra,
});

describe("pipeline — cas contractuels du Plan §08", () => {
  it("garde de 24 h : in 08:00 J1 → out 08:15 J2 = 1 session sur J1, 24 h travaillées, 15 min d'heures sup., J2 sans absence", () => {
    const result = computeDay({
      employeeId: "e1",
      workDate: J1,
      punches: [
        { employeeId: "e1", punchedAt: at(J1, 8, 0), siteId: "bloc-a" },
        { employeeId: "e1", punchedAt: at(new Date(J1.getTime() + DAY), 8, 15), siteId: "bloc-a" },
      ],
      plan: plan(garde24h),
      absence: null,
    });
    expect(result.sessions).toHaveLength(1);
    expect(result.workedMin).toBe(24 * 60 + 15);
    expect(result.overtimeMin).toBe(15);
    expect(result.flags).not.toContain("MISSING_OUT");
    // Le lendemain n'est pas un jour travaillé : pas de pointages → travaillé 0, pas d'absence créée par le moteur.
    const j2 = computeDay({
      employeeId: "e1",
      workDate: new Date(J1.getTime() + DAY),
      punches: [],
      plan: plan(null, { isRestDay: true }),
      absence: null,
    });
    expect(j2.workedMin).toBeNull();
    expect(j2.flags).toHaveLength(0);
  });

  it("poste de nuit 20:00 → 06:00 : jour ouvré = date de début, les deux pointages se rattachent à J1", () => {
    const inPunch = at(J1, 20, 0);
    const outPunch = at(new Date(J1.getTime() + DAY), 6, 0);
    expect(resolveBusinessDay(inPunch, nuit)).toEqual(J1);
    expect(resolveBusinessDay(outPunch, nuit)).toEqual(J1);

    const result = computeDay({
      employeeId: "e1",
      workDate: J1,
      punches: [
        { employeeId: "e1", punchedAt: inPunch, siteId: "bloc-a" },
        { employeeId: "e1", punchedAt: outPunch, siteId: "bloc-a" },
      ],
      plan: plan(nuit),
      absence: null,
    });
    expect(result.workedMin).toBe(10 * 60 - 30); // 10 h moins 30 min de pause
    expect(result.lateMin).toBe(0);
    expect(result.earlyLeaveMin).toBe(0);
  });

  it("roulement 3×8, semaine de bascule : l'expansion produit le bon gabarit par jour, transition incluse", () => {
    // Cycle 6 jours : M, M, A, A, N, N puis repos (simplifié à 7 étapes)
    const steps = [
      { dayIndex: 0, shiftTemplateId: "matin" },
      { dayIndex: 1, shiftTemplateId: "matin" },
      { dayIndex: 2, shiftTemplateId: "apres-midi" },
      { dayIndex: 3, shiftTemplateId: "apres-midi" },
      { dayIndex: 4, shiftTemplateId: "nuit" },
      { dayIndex: 5, shiftTemplateId: "nuit" },
      { dayIndex: 6, shiftTemplateId: null }, // repos
    ];
    const anchor = new Date(Date.UTC(2026, 5, 1));
    const from = new Date(Date.UTC(2026, 5, 29)); // semaine de bascule de mois
    const to = new Date(Date.UTC(2026, 6, 5));
    const entries = expandCycle(steps, anchor, from, to);
    expect(entries).toHaveLength(7);
    // 29/06 = jour 28 depuis l'ancre → 28 mod 7 = 0 → matin ; la séquence traverse le 1er juillet sans rupture.
    expect(entries.map((e) => e.shiftTemplateId)).toEqual([
      "matin",
      "matin",
      "apres-midi",
      "apres-midi",
      "nuit",
      "nuit",
      null,
    ]);
  });

  it("sortie manquante : MISSING_OUT, minutes travaillées nulles, jour exclu de l'export paie", () => {
    const result = computeDay({
      employeeId: "e1",
      workDate: J1,
      punches: [{ employeeId: "e1", punchedAt: at(J1, 8, 5), siteId: "bloc-a" }],
      plan: plan(journee),
      absence: null,
    });
    expect(result.flags).toContain("MISSING_OUT");
    expect(result.workedMin).toBeNull();
  });

  it("congé annuel approuvé sur un poste planifié : théorique préservé, travaillé = 0, aucune anomalie, imputé sur le solde", () => {
    const result = computeDay({
      employeeId: "e1",
      workDate: J1,
      punches: [],
      plan: plan(journee),
      absence: { coversDay: true, fraction: 1 },
    });
    expect(result.theoreticalMin).toBe(9 * 60 - 45);
    expect(result.workedMin).toBe(0);
    expect(result.flags).toHaveLength(0);
  });

  it("pointage sur un bloc non affecté : accepté, enregistré, signalé OFF_SITE — jamais rejeté silencieusement", () => {
    const result = computeDay({
      employeeId: "e1",
      workDate: J1,
      punches: [
        { employeeId: "e1", punchedAt: at(J1, 8, 0), siteId: "bloc-b" },
        { employeeId: "e1", punchedAt: at(J1, 17, 0), siteId: "bloc-b" },
      ],
      plan: plan(journee), // plan.siteId = bloc-a
      absence: null,
    });
    expect(result.flags).toContain("OFF_SITE");
    expect(result.workedMin).toBeGreaterThan(0);
  });

  it("changement de planning rétroactif sur un mois clôturé : recalcul refusé, déverrouillage explicite tracé requis", () => {
    expect(() =>
      computeDay({
        employeeId: "e1",
        workDate: J1,
        punches: [],
        plan: plan(journee, { locked: true }),
        absence: null,
      }),
    ).toThrow(RecomputeRefusedError);
  });

  it("livraison push dupliquée après retry : idempotent, pas de double pointage", () => {
    const raw = [
      { employeeId: "e1", punchedAt: at(J1, 8, 0), siteId: "bloc-a" },
      { employeeId: "e1", punchedAt: at(J1, 8, 0), siteId: "bloc-a" }, // retry terminal
    ];
    expect(normalise(raw, 2)).toHaveLength(1);
  });

  it("badgeage double en 30 s : un seul événement conservé", () => {
    const raw = [
      { employeeId: "e1", punchedAt: at(J1, 8, 0), siteId: "bloc-a" },
      { employeeId: "e1", punchedAt: at(J1, 8, 0) , siteId: "bloc-a" },
      { employeeId: "e1", punchedAt: at(J1, 8, 0) , siteId: "bloc-a" },
    ];
    raw[1]!.punchedAt.setSeconds(15);
    raw[2]!.punchedAt.setSeconds(30);
    expect(normalise(raw, 2)).toHaveLength(1);
  });

  it("transition impossible : deux blocs distincts à moins de 30 minutes", () => {
    const p1 = { employeeId: "e1", punchedAt: at(J1, 8, 0), siteId: "bloc-a" };
    const p2 = { employeeId: "e1", punchedAt: at(J1, 8, 10), siteId: "bloc-b" };
    const sessions = pairSessions([p1, p2]);
    expect(sessions).toHaveLength(1);
    const result = computeDay({
      employeeId: "e1",
      workDate: J1,
      punches: [p1, p2],
      plan: plan(journee),
      absence: null,
    });
    expect(result.flags).toContain("IMPOSSIBLE_TRANSITION");
  });
});
