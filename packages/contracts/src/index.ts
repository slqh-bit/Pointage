/**
 * Contrats partagés — Plan de développement §03 / §09.
 * Schémas zod = source de vérité validation, types TS dérivés.
 * Utilisés par l'API (Fastify/typebox côté serveur), le portail web et le mobile.
 */
import { z } from "zod";

// ─── Énumérations métier (miroir du schéma Prisma) ───────────────────────────

export const PunchSource = z.enum(["TERMINAL", "WEB", "MOBILE"]);
export type PunchSource = z.infer<typeof PunchSource>;

export const VerifyMode = z.enum(["FACE", "FINGERPRINT", "BADGE", "PIN", "GPS_ONLY"]);
export type VerifyMode = z.infer<typeof VerifyMode>;

export const DeviceBrand = z.enum(["ZKTECO", "SUPREMA", "HIKVISION"]);
export type DeviceBrand = z.infer<typeof DeviceBrand>;

export const AnomalyCode = z.enum([
  "MISSING_OUT",
  "MISSING_IN",
  "NO_PLAN",
  "OFF_SITE",
  "IMPOSSIBLE_TRANSITION",
  "OVERTIME_PENDING",
  "GEOFENCE_VIOLATION",
]);
export type AnomalyCode = z.infer<typeof AnomalyCode>;

export const RoleCode = z.enum(["ADMIN", "DRH", "GESTIONNAIRE", "SUPERVISEUR"]);
export type RoleCode = z.infer<typeof RoleCode>;

export const AbsenceStatus = z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]);
export type AbsenceStatus = z.infer<typeof AbsenceStatus>;

// ─── Capture ─────────────────────────────────────────────────────────────────

/** POST /api/v1/punches — pointage web / mobile (§09). */
export const PunchCreateSchema = z.object({
  employeeId: z.string().min(1),
  punchedAt: z.coerce.date(),
  source: PunchSource.exclude(["TERMINAL"]),
  verifyMode: VerifyMode.optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});
export type PunchCreate = z.infer<typeof PunchCreateSchema>;

/** Pointage brut tel que remonté par un terminal (jamais muté, §06). */
export const RawPunchSchema = z.object({
  deviceId: z.string().min(1),
  deviceUserId: z.string().min(1),
  punchedAt: z.coerce.date(),
  verifyMode: VerifyMode.optional(),
  rawPayload: z.record(z.unknown()).optional(),
});
export type RawPunch = z.infer<typeof RawPunchSchema>;

// ─── Planning ────────────────────────────────────────────────────────────────

export const ShiftTemplateSchema = z.object({
  code: z.string().min(1).max(30),
  nameFr: z.string().min(1),
  nameAr: z.string().optional(),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:mm"),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:mm"),
  crossesMidnight: z.boolean().default(false),
  graceLateMin: z.number().int().min(0).default(0),
  graceEarlyLeaveMin: z.number().int().min(0).default(0),
  breakMin: z.number().int().min(0).default(0),
  breakDeducted: z.boolean().default(true),
});
export type ShiftTemplateInput = z.infer<typeof ShiftTemplateSchema>;

export const ScheduleEntrySchema = z.object({
  employeeId: z.string().min(1),
  workDate: z.coerce.date(),
  shiftTemplateId: z.string().nullable().optional(),
  isRestDay: z.boolean().default(false),
});
export type ScheduleEntryInput = z.infer<typeof ScheduleEntrySchema>;

/** POST /api/v1/cycles/:id/apply — expansion d'un roulement sur une période. */
export const CycleApplySchema = z.object({
  employeeIds: z.array(z.string().min(1)).min(1),
  from: z.coerce.date(),
  to: z.coerce.date(),
  anchorDate: z.coerce.date(),
});
export type CycleApply = z.infer<typeof CycleApplySchema>;

// ─── Absences ────────────────────────────────────────────────────────────────

export const AbsenceRequestCreateSchema = z.object({
  employeeId: z.string().min(1),
  absenceTypeId: z.string().min(1),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  halfDayStart: z.boolean().default(false),
  halfDayEnd: z.boolean().default(false),
  reason: z.string().max(500).optional(),
});
export type AbsenceRequestCreate = z.infer<typeof AbsenceRequestCreateSchema>;

/** POST /api/v1/absences/:id/decision — approve | reject + motif (§09). */
export const AbsenceDecisionSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  motif: z.string().max(500).optional(),
});
export type AbsenceDecision = z.infer<typeof AbsenceDecisionSchema>;

// ─── Résultats & rapports ────────────────────────────────────────────────────

export const DayResultSchema = z.object({
  employeeId: z.string(),
  workDate: z.coerce.date(),
  theoreticalMin: z.number().int().nullable(),
  workedMin: z.number().int().nullable(),
  lateMin: z.number().int(),
  earlyLeaveMin: z.number().int(),
  overtimeMin: z.number().int(),
  breakDeductedMin: z.number().int(),
  anomalyFlags: z.array(AnomalyCode),
});
export type DayResultDto = z.infer<typeof DayResultSchema>;

export const ReportRequestSchema = z.object({
  kind: z.enum(["PRESENCE", "ABSENCE", "RETARDS", "HEURES_SUP", "ECARTS_PLANNING"]),
  from: z.coerce.date(),
  to: z.coerce.date(),
  serviceId: z.string().optional(),
});
export type ReportRequest = z.infer<typeof ReportRequestSchema>;

export const ExportFormat = z.enum(["xlsx", "pdf", "csv"]);
export type ExportFormat = z.infer<typeof ExportFormat>;

// ─── Intégration ─────────────────────────────────────────────────────────────

export const WebhookEvent = z.enum(["punch.created", "absence.approved", "device.offline"]);
export type WebhookEvent = z.infer<typeof WebhookEvent>;

export const WebhookSubscriptionSchema = z.object({
  url: z.string().url(),
  events: z.array(WebhookEvent).min(1),
});
export type WebhookSubscriptionInput = z.infer<typeof WebhookSubscriptionSchema>;

// ─── Auth ────────────────────────────────────────────────────────────────────

export const LoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(8),
});
export type LoginInput = z.infer<typeof LoginSchema>;

/** Charge utile du JWT d'accès (§03 : JWT access + refresh). */
export interface AccessTokenPayload {
  sub: string; // user id
  role: RoleCode;
  scopeServiceIds: string[]; // vide = accès complet (ALL)
  employeeId: string | null;
}
