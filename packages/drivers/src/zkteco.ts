/**
 * Adaptateur ZKTeco — Plan §06, modes A et B.
 *
 * Mode A (ADMS push) : aucun code ici — l'ingress HTTP vit dans
 * apps/api/src/modules/device/iclock.routes.ts. Cet adaptateur couvre le
 * mode B : pull planifié via le protocole ZK TCP/IP ouvert (zklib-js /
 * node-zklib, MIT — §03), plus provisionnement, horloge et état.
 *
 * La dépendance `node-zklib` est chargée dynamiquement pour rester
 * optionnelle : l'API démarre et le push ADMS fonctionne sans elle.
 */
import type {
  DeviceDriver,
  DeviceHealth,
  DeviceInfo,
  DeviceUser,
  RawPunch,
  SyncReport,
  Template,
} from "./device-driver.js";

export interface ZktecoDriverOptions {
  ip: string;
  port?: number; // défaut protocole ZK : 4370
  timeoutMs?: number;
  /** Pont .NET 4.8 pour les gabarits, si le spike P0 montre qu'il est requis. */
  templateBridgeUrl?: string;
}

interface ZkConnection {
  createSocket(): Promise<void>;
  getAttendances(): Promise<{ data: Array<{ userId: string; recordTime: string | Date }> }>;
  getUsers(): Promise<{ data: Array<{ userId: string; name: string }> }>;
  setUser(uid: number, userId: string, name: string, password: string, role: number, cardno: number): Promise<void>;
  getDeviceInfo?(): Promise<Record<string, unknown>>;
  setTime?(t: Date): Promise<void>;
  disconnect(): Promise<void>;
}

async function loadZklib(): Promise<new (ip: string, port: number, timeout: number, inport: number) => ZkConnection> {
  const mod = (await import("node-zklib")) as { default: unknown };
  return mod.default as new (ip: string, port: number, timeout: number, inport: number) => ZkConnection;
}

export class ZktecoDriver implements DeviceDriver {
  private readonly ip: string;
  private readonly port: number;
  private readonly timeoutMs: number;
  private readonly templateBridgeUrl?: string;

  constructor(opts: ZktecoDriverOptions) {
    this.ip = opts.ip;
    this.port = opts.port ?? 4370;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    if (opts.templateBridgeUrl !== undefined) this.templateBridgeUrl = opts.templateBridgeUrl;
  }

  private async withConnection<T>(fn: (zk: ZkConnection) => Promise<T>): Promise<T> {
    const ZKLib = await loadZklib();
    const zk = new ZKLib(this.ip, this.port, this.timeoutMs, 5200);
    await zk.createSocket();
    try {
      return await fn(zk);
    } finally {
      await zk.disconnect().catch(() => undefined);
    }
  }

  async probe(): Promise<DeviceInfo> {
    return this.withConnection(async (zk) => {
      const info = (await zk.getDeviceInfo?.()) ?? {};
      const users = await zk.getUsers();
      return {
        brand: "ZKTECO",
        serialNumber: String(info["serialNumber"] ?? ""),
        firmware: String(info["firmwareVersion"] ?? ""),
        capacities: {
          face: true,
          fingerprint: true,
          badge: true,
          maxUsers: Number(info["userCapacity"] ?? 3000),
          maxTemplates: Number(info["faceCapacity"] ?? 3000),
        },
        ...(users.data.length >= 0 ? { model: String(info["platform"] ?? "ZK") } : {}),
      };
    });
  }

  async pullEvents(since: Date): Promise<RawPunch[]> {
    return this.withConnection(async (zk) => {
      const logs = await zk.getAttendances();
      return logs.data
        .map((row) => ({
          deviceId: this.ip, // résolu en id métier par l'appelant (registry)
          deviceUserId: String(row.userId),
          punchedAt: new Date(row.recordTime),
        }))
        .filter((p) => p.punchedAt >= since);
    });
  }

  async pushUsers(users: DeviceUser[]): Promise<SyncReport> {
    return this.withConnection(async (zk) => {
      const report: SyncReport = { pushed: 0, failed: 0, errors: [] };
      for (const [i, u] of users.entries()) {
        try {
          await zk.setUser(i + 1, u.deviceUserId, u.fullName.slice(0, 24), "", 0, 0);
          report.pushed += 1;
        } catch (err) {
          report.failed += 1;
          report.errors.push({ deviceUserId: u.deviceUserId, message: String(err) });
        }
      }
      return report;
    });
  }

  async readTemplate(userId: string, kind: "FACE_TEMPLATE" | "FINGERPRINT_TEMPLATE"): Promise<Template> {
    if (!this.templateBridgeUrl) {
      throw new Error(
        "Gabarits biométriques : pont .NET 4.8 non configuré. " +
          "Le spike P0 doit décider si le protocole ouvert suffit (Plan §06, mode C).",
      );
    }
    const res = await fetch(`${this.templateBridgeUrl}/templates/${encodeURIComponent(userId)}?kind=${kind}`);
    if (!res.ok) throw new Error(`bridge readTemplate failed: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return { userId, kind, data: buf };
  }

  async writeTemplate(userId: string, t: Template): Promise<void> {
    if (!this.templateBridgeUrl) {
      throw new Error("Gabarits biométriques : pont .NET 4.8 non configuré (Plan §06, mode C).");
    }
    const res = await fetch(`${this.templateBridgeUrl}/templates/${encodeURIComponent(userId)}`, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream" },
      body: t.data,
    });
    if (!res.ok) throw new Error(`bridge writeTemplate failed: ${res.status}`);
  }

  async syncTime(): Promise<void> {
    await this.withConnection(async (zk) => {
      await zk.setTime?.(new Date());
    });
  }

  async health(): Promise<DeviceHealth> {
    try {
      await this.withConnection(async () => undefined);
      return { online: true, lastSeenAt: new Date(), storageFreeKb: null, tamperState: false };
    } catch {
      return { online: false, lastSeenAt: null, storageFreeKb: null, tamperState: false };
    }
  }
}
