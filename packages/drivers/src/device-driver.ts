/**
 * Contrat DeviceDriver — Plan de développement §06.
 *
 * Le point de variation unique du système : ajouter Suprema ou Hikvision
 * revient à implémenter ce contrat, rien d'autre. C'est ce qui satisfait
 * structurellement la clause « compatibilité multi-marques » du CCTP.
 *
 * Trois modes de transport aboutissent sur cette interface :
 *   A — ADMS push (primaire) : le terminal POST ses pointages en HTTP.
 *   B — Pull planifié via zklib-js / node-zklib (réconciliation nocturne).
 *   C — Pont .NET 4.8 : gabarits biométriques uniquement, si P0 l'exige.
 */
import type { DeviceBrand, RawPunch, VerifyMode } from "@pointage/contracts";

export interface DeviceInfo {
  brand: DeviceBrand;
  serialNumber: string;
  firmware: string;
  model?: string;
  /** Capacités déclarées par le firmware (face, empreinte, badge, nb gabarits). */
  capacities: {
    face: boolean;
    fingerprint: boolean;
    badge: boolean;
    maxUsers: number;
    maxTemplates: number;
  };
}

export interface DeviceUser {
  deviceUserId: string;
  matricule: string;
  fullName: string;
  /** Gabarits à pousser — références opaques, jamais d'image brute (loi 63/2004). */
  templates?: Template[];
}

export interface Template {
  userId: string;
  kind: "FACE_TEMPLATE" | "FINGERPRINT_TEMPLATE";
  /** Référence opaque non réversible — jamais l'image source. */
  data: Buffer;
}

export interface SyncReport {
  pushed: number;
  failed: number;
  errors: Array<{ deviceUserId: string; message: string }>;
}

export interface DeviceHealth {
  online: boolean;
  lastSeenAt: Date | null;
  /** Espace de stockage restant (Ko) quand le firmware l'expose. */
  storageFreeKb: number | null;
  tamperState: boolean;
}

export interface DeviceDriver {
  /** Sonde le terminal : série, firmware, capacités. */
  probe(): Promise<DeviceInfo>;
  /** Re-lit la fenêtre de logs depuis `since` (réconciliation — mode B). */
  pullEvents(since: Date): Promise<RawPunch[]>;
  /** Provisionne la liste d'utilisateurs sur le terminal. */
  pushUsers(users: DeviceUser[]): Promise<SyncReport>;
  /** Lit un gabarit biométrique (peut déléguer au pont .NET — mode C). */
  readTemplate(userId: string, kind: "FACE_TEMPLATE" | "FINGERPRINT_TEMPLATE"): Promise<Template>;
  /** Écrit un gabarit biométrique (peut déléguer au pont .NET — mode C). */
  writeTemplate(userId: string, t: Template): Promise<void>;
  /** Synchronise l'horloge du terminal sur le serveur. */
  syncTime(): Promise<void>;
  /** État de santé : en ligne, stockage, sabotage. */
  health(): Promise<DeviceHealth>;
}

export type { RawPunch, VerifyMode };
