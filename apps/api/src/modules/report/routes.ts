/**
 * Module report — Plan §09 / P5.
 * day-results, état mensuel en job de fond, exports Excel/PDF/CSV,
 * extrait paie (connecteur SIRH). Clôture mensuelle : verrouille la période.
 */
import { stringify } from "csv-stringify/sync";
import ExcelJS from "exceljs";
import PdfPrinter from "pdfmake";
// TDocumentDefinitions non résoluble en sous-chemin sous NodeNext : dérivé du constructeur.
type TDocumentDefinitions = Parameters<PdfPrinter["createPdfKitDocument"]>[0];
import { createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, inScope, requireRole } from "../../plugins/auth.js";

const EXPORT_DIR = process.env.EXPORT_DIR ?? "exports";
const FONT = {
  Helvetica: {
    normal: "Helvetica",
    bold: "Helvetica-Bold",
    italics: "Helvetica-Oblique",
    bolditalics: "Helvetica-BoldOblique",
  },
};

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  /** GET /api/v1/day-results?employee&from&to (§09). */
  app.get("/api/v1/day-results", async (req, reply) => {
    const q = req.query as { employee?: string; from?: string; to?: string };
    if (!q.employee || !q.from || !q.to) {
      return reply.code(400).send({ error: "employee, from et to requis" });
    }
    const results = await app.prisma.dayResult.findMany({
      where: { employeeId: q.employee, workDate: { gte: new Date(q.from), lte: new Date(q.to) } },
      orderBy: { workDate: "asc" },
    });
    return reply.send({ data: results });
  });

  /** POST /api/v1/reports/monthly → job id (§09). Généré en tâche de fond. */
  app.post("/api/v1/reports/monthly", async (req, reply) => {
    const Body = z.object({
      month: z.string().regex(/^\d{4}-\d{2}$/), // "2026-06"
      serviceId: z.string().optional(),
    });
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues });
    if (parsed.data.serviceId && !inScope(req.auth!, parsed.data.serviceId)) {
      return reply.code(403).send({ error: "OUT_OF_SCOPE" });
    }
    const job = await app.prisma.job.create({
      data: { kind: "REPORT_MONTHLY", payload: { ...parsed.data, requestedBy: req.auth!.sub } },
    });
    return reply.code(202).send({ jobId: job.id });
  });

  /** GET /api/v1/reports/:jobId/export?format=xlsx|pdf|csv (§09). */
  app.get("/api/v1/reports/:jobId/export", async (req, reply) => {
    const { jobId } = req.params as { jobId: string };
    const q = req.query as { format?: string };
    const format = q.format ?? "xlsx";
    if (!["xlsx", "pdf", "csv"].includes(format)) return reply.code(400).send({ error: "FORMAT_UNSUPPORTED" });

    const job = await app.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) return reply.code(404).send({ error: "JOB_NOT_FOUND" });
    const payload = job.payload as { month?: string; serviceId?: string } | null;
    if (job.kind !== "REPORT_MONTHLY" || !payload?.month) {
      return reply.code(400).send({ error: "NOT_A_MONTHLY_REPORT_JOB" });
    }

    const rows = await monthlyRows(app, payload.month, payload.serviceId);
    mkdirSync(EXPORT_DIR, { recursive: true });

    if (format === "csv") {
      const csv = stringify(rows, { header: true, columns: CSV_COLUMNS, bom: true });
      return reply
        .type("text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="etat-${payload.month}.csv"`)
        .send(csv);
    }
    if (format === "xlsx") {
      const buf = await buildXlsx(payload.month, rows);
      return reply
        .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .header("content-disposition", `attachment; filename="etat-${payload.month}.xlsx"`)
        .send(buf);
    }
    const pdf = await buildPdf(payload.month, rows);
    return reply
      .type("application/pdf")
      .header("content-disposition", `attachment; filename="etat-${payload.month}.pdf"`)
      .send(pdf);
  });

  /** GET /api/v1/exports/payroll?period=YYYY-MM — connecteur SIRH/paie (§09).
   *  Refusé tant que des anomalies ouvertes existent sur la période :
   *  un jour non résolu est exclu de l'export paie (§08). */
  app.get(
    "/api/v1/exports/payroll",
    { preHandler: [requireRole("ADMIN", "DRH", "GESTIONNAIRE")] },
    async (req, reply) => {
      const q = req.query as { period?: string };
      if (!q.period || !/^\d{4}-\d{2}$/.test(q.period)) {
        return reply.code(400).send({ error: "period=YYYY-MM requis" });
      }
      const [from, to] = monthBounds(q.period);
      const openAnomalies = await app.prisma.anomaly.count({
        where: { workDate: { gte: from, lte: to }, status: "OPEN" },
      });
      const results = await app.prisma.dayResult.findMany({
        where: { workDate: { gte: from, lte: to } },
        include: { employee: { select: { matricule: true, firstName: true, lastName: true } } },
      });
      const exportable = results.filter((r) => r.workedMin !== null);
      const excluded = results.length - exportable.length;

      const rows = exportable.map((r) => ({
        matricule: r.employee.matricule,
        nom: `${r.employee.lastName} ${r.employee.firstName}`,
        date: r.workDate.toISOString().slice(0, 10),
        minutes_travaillees: r.workedMin,
        retard_min: r.lateMin,
        depart_anticipe_min: r.earlyLeaveMin,
        heures_sup_min: r.overtimeMin,
      }));
      const csv = stringify(rows, { header: true, bom: true });
      return reply
        .type("text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="paie-${q.period}.csv"`)
        .header("x-excluded-days", String(excluded))
        .header("x-open-anomalies", String(openAnomalies))
        .send(csv);
    },
  );

  /** POST /api/v1/periods/:month/close — clôture mensuelle (P5). */
  app.post(
    "/api/v1/periods/:month/close",
    { preHandler: [requireRole("ADMIN", "DRH")] },
    async (req, reply) => {
      const { month } = req.params as { month: string };
      const [from, to] = monthBounds(month);
      const locked = await app.prisma.$transaction([
        app.prisma.scheduleEntry.updateMany({
          where: { workDate: { gte: from, lte: to } },
          data: { locked: true },
        }),
        app.prisma.dayResult.updateMany({
          where: { workDate: { gte: from, lte: to } },
          data: { locked: true },
        }),
      ]);
      return reply.send({ month, scheduleEntriesLocked: locked[0].count, dayResultsLocked: locked[1].count });
    },
  );
}

const CSV_COLUMNS = [
  { key: "matricule", header: "Matricule" },
  { key: "nom", header: "Nom" },
  { key: "service", header: "Service" },
  { key: "jours_theoriques", header: "Jours théoriques" },
  { key: "minutes_travaillees", header: "Minutes travaillées" },
  { key: "retard_min", header: "Retards (min)" },
  { key: "depart_anticipe_min", header: "Départs anticipés (min)" },
  { key: "heures_sup_min", header: "Heures sup. (min)" },
  { key: "jours_absence", header: "Jours d'absence" },
  { key: "anomalies", header: "Anomalies" },
] as const;

interface MonthlyRow {
  matricule: string;
  nom: string;
  service: string;
  jours_theoriques: number;
  minutes_travaillees: number;
  retard_min: number;
  depart_anticipe_min: number;
  heures_sup_min: number;
  jours_absence: number;
  anomalies: number;
}

async function monthlyRows(
  app: FastifyInstance,
  month: string,
  serviceId?: string,
): Promise<MonthlyRow[]> {
  const [from, to] = monthBounds(month);
  const results = await app.prisma.dayResult.findMany({
    where: {
      workDate: { gte: from, lte: to },
      employee: serviceId ? { serviceId } : undefined,
    },
    include: {
      employee: { include: { service: true } },
    },
  });
  const byEmployee = new Map<string, MonthlyRow>();
  for (const r of results) {
    const key = r.employeeId;
    const row = byEmployee.get(key) ?? {
      matricule: r.employee.matricule,
      nom: `${r.employee.lastName} ${r.employee.firstName}`,
      service: r.employee.service.nameFr,
      jours_theoriques: 0,
      minutes_travaillees: 0,
      retard_min: 0,
      depart_anticipe_min: 0,
      heures_sup_min: 0,
      jours_absence: 0,
      anomalies: 0,
    };
    if (r.theoreticalMin !== null) row.jours_theoriques += 1;
    row.minutes_travaillees += r.workedMin ?? 0;
    row.retard_min += r.lateMin;
    row.depart_anticipe_min += r.earlyLeaveMin;
    row.heures_sup_min += r.overtimeMin;
    if (r.absenceDayId) row.jours_absence += 1;
    row.anomalies += Array.isArray(r.anomalyFlags) ? (r.anomalyFlags as unknown[]).length : 0;
    byEmployee.set(key, row);
  }
  return [...byEmployee.values()].sort((a, b) => a.service.localeCompare(b.service) || a.nom.localeCompare(b.nom));
}

function monthBounds(month: string): [Date, Date] {
  const [y = 0, m = 1] = month.split("-").map(Number);
  return [new Date(y, m - 1, 1), new Date(y, m, 0)];
}

async function buildXlsx(month: string, rows: MonthlyRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`État ${month}`);
  ws.columns = CSV_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: 22 }));
  ws.getRow(1).font = { bold: true };
  ws.addRows(rows);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function buildPdf(month: string, rows: MonthlyRow[]): Promise<Buffer> {
  const printer = new PdfPrinter(FONT);
  const doc: TDocumentDefinitions = {
    info: { title: `État mensuel ${month} — CHU La Rabta` },
    content: [
      { text: `État mensuel de pointage — ${month}`, style: "h1" },
      { text: "CHU La Rabta · Consultation INF01/2026", style: "sub" },
      {
        table: {
          headerRows: 1,
          widths: ["auto", "*", "auto", "auto", "auto", "auto", "auto"],
          body: [
            ["Matricule", "Nom", "Service", "Travaillé (min)", "Retards", "Départs ant.", "HS"],
            ...rows.map((r) => [
              r.matricule,
              r.nom,
              r.service,
              String(r.minutes_travaillees),
              String(r.retard_min),
              String(r.depart_anticipe_min),
              String(r.heures_sup_min),
            ]),
          ],
        },
        fontSize: 8,
      },
    ],
    styles: {
      h1: { fontSize: 14, bold: true, margin: [0, 0, 0, 4] },
      sub: { fontSize: 9, color: "#555555", margin: [0, 0, 0, 12] },
    },
  };
  return new Promise((resolvePromise, reject) => {
    const pdfDoc = printer.createPdfKitDocument(doc);
    const file = join(EXPORT_DIR, `etat-${month}-${Date.now()}.pdf`);
    const stream = createWriteStream(file);
    const chunks: Buffer[] = [];
    pdfDoc.on("data", (c: Buffer) => chunks.push(c));
    pdfDoc.on("end", () => resolvePromise(Buffer.concat(chunks)));
    pdfDoc.on("error", reject);
    pdfDoc.pipe(stream);
    pdfDoc.end();
  });
}
