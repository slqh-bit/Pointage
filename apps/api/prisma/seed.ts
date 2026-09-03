/**
 * Seed P1 — les 25 blocs et 35+ services (Plan §11, P1).
 * Jeu minimal reproductible : à remplacer par l'import du fichier RH réel
 * (matricule, service, catégorie) lors de la phase P1.
 */
import { hash } from "@node-rs/argon2";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  // ── Catégories d'agents (le jeu de règles applicable dépend de la catégorie)
  const categories = [
    { code: "MEDICAL", nameFr: "Médical", nameAr: "طبي", ruleSetKey: "medical" },
    { code: "PARAMEDICAL", nameFr: "Paramédical", nameAr: "شبه طبي", ruleSetKey: "paramedical" },
    { code: "ADMINISTRATIF", nameFr: "Administratif", nameAr: "إداري", ruleSetKey: "administratif" },
    { code: "OUVRIER", nameFr: "Ouvrier", nameAr: "عامل", ruleSetKey: "ouvrier" },
  ];
  for (const c of categories) {
    await prisma.employeeCategory.upsert({ where: { code: c.code }, update: {}, create: c });
  }

  // ── Rôles — les quatre profils CCTP
  const roles = [
    { code: "ADMIN", nameFr: "Administrateur", permissions: ["*"] },
    { code: "DRH", nameFr: "DRH", permissions: ["planning:write", "absence:decide", "report:export", "device:manage", "period:unlock"] },
    { code: "GESTIONNAIRE", nameFr: "Gestionnaire", permissions: ["planning:write", "absence:decide", "overtime:validate", "report:export"] },
    { code: "SUPERVISEUR", nameFr: "Superviseur", permissions: ["anomaly:resolve", "punch:correct"] },
  ];
  for (const r of roles) {
    const role = await prisma.role.upsert({
      where: { code: r.code },
      update: {},
      create: { code: r.code, nameFr: r.nameFr },
    });
    for (const key of r.permissions) {
      await prisma.permission.upsert({
        where: { roleId_key: { roleId: role.id, key } },
        update: {},
        create: { roleId: role.id, key },
      });
    }
  }

  // ── Gabarits de poste de base : journée, 3×8, garde 24 h
  const shifts = [
    { code: "JOUR", nameFr: "Journée 08:00–17:00", startTime: "08:00", endTime: "17:00", crossesMidnight: false, graceLateMin: 10, graceEarlyLeaveMin: 10, breakMin: 45, breakDeducted: true },
    { code: "MATIN", nameFr: "Matin 06:00–14:00", startTime: "06:00", endTime: "14:00", crossesMidnight: false, graceLateMin: 10, graceEarlyLeaveMin: 10, breakMin: 30, breakDeducted: true },
    { code: "APM", nameFr: "Après-midi 14:00–22:00", startTime: "14:00", endTime: "22:00", crossesMidnight: false, graceLateMin: 10, graceEarlyLeaveMin: 10, breakMin: 30, breakDeducted: true },
    { code: "NUIT", nameFr: "Nuit 22:00–06:00", startTime: "22:00", endTime: "06:00", crossesMidnight: true, graceLateMin: 10, graceEarlyLeaveMin: 10, breakMin: 30, breakDeducted: true },
    { code: "GARDE24", nameFr: "Garde 24 h 08:00→08:00", startTime: "08:00", endTime: "08:00", crossesMidnight: true, graceLateMin: 15, graceEarlyLeaveMin: 15, breakMin: 0, breakDeducted: false },
  ];
  for (const s of shifts) {
    await prisma.shiftTemplate.upsert({ where: { code: s.code }, update: {}, create: s });
  }

  // ── Cycle 3×8 : M M A A N N R
  const cycle = await prisma.cycle.upsert({
    where: { code: "3X8" },
    update: {},
    create: { code: "3X8", nameFr: "Roulement 3×8 (2M 2A 2N 1R)", lengthDays: 7 },
  });
  const stepMap: Array<[number, string | null]> = [
    [0, "MATIN"], [1, "MATIN"], [2, "APM"], [3, "APM"], [4, "NUIT"], [5, "NUIT"], [6, null],
  ];
  for (const [dayIndex, code] of stepMap) {
    const shift = code ? await prisma.shiftTemplate.findUnique({ where: { code } }) : null;
    await prisma.cycleStep.upsert({
      where: { cycleId_dayIndex: { cycleId: cycle.id, dayIndex } },
      update: { shiftTemplateId: shift?.id ?? null },
      create: { cycleId: cycle.id, dayIndex, shiftTemplateId: shift?.id ?? null },
    });
  }

  // ── Types d'absence
  const absenceTypes = [
    { code: "CONGE_ANNUEL", nameFr: "Congé annuel", nameAr: "عطلة سنوية", paid: true, countsAgainstBalance: true },
    { code: "MALADIE", nameFr: "Congé maladie", nameAr: "عطلة مرض", paid: true, countsAgainstBalance: false, requiresJustification: true },
    { code: "AUTORISATION", nameFr: "Autorisation d'absence", nameAr: "رخصة غياب", paid: true, countsAgainstBalance: false },
    { code: "MISSION", nameFr: "Mission", nameAr: "مهمة", paid: true, countsAgainstBalance: false },
  ];
  for (const t of absenceTypes) {
    await prisma.absenceType.upsert({ where: { code: t.code }, update: {}, create: t });
  }

  // ── Bloc et service d'exemple (les 25 blocs / 35+ services viennent de l'import RH P1)
  const site = await prisma.site.upsert({
    where: { code: "BLOC-A" },
    update: {},
    create: { code: "BLOC-A", nameFr: "Bloc A — exemple", lat: 36.8, lng: 10.18, geofenceRadiusM: 150 },
  });
  const service = await prisma.service.upsert({
    where: { siteId_code: { siteId: site.id, code: "SVC-EX" } },
    update: {},
    create: { siteId: site.id, code: "SVC-EX", nameFr: "Service exemple" },
  });

  // ── Compte administrateur initial (mot de passe à changer à la 1re connexion)
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: "ADMIN" } });
  await prisma.user.upsert({
    where: { username: "admin" },
    update: {},
    create: {
      username: "admin",
      passwordHash: await hash(process.env.ADMIN_INITIAL_PASSWORD ?? "ChangeMe!2026"),
      roleId: adminRole.id,
    },
  });

  console.log("Seed P1 terminé :", { site: site.code, service: service.code });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
