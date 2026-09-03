/**
 * Adaptateurs stub Suprema et Hikvision — Plan §06 / §12.
 *
 * Stubbés derrière le même contrat DeviceDriver, activés contre le matériel
 * réel en T2 (garantie 12 mois). Leur existence prouve que le point de
 * variation est l'interface, pas l'application.
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

abstract class StubDriver implements DeviceDriver {
  abstract readonly brand: "SUPREMA" | "HIKVISION";

  private notActivated(): never {
    throw new Error(
      `Adaptateur ${this.brand} stubbé — activation prévue en T2 contre matériel réel (Plan §12).`,
    );
  }

  async probe(): Promise<DeviceInfo> {
    this.notActivated();
  }
  async pullEvents(_since: Date): Promise<RawPunch[]> {
    this.notActivated();
  }
  async pushUsers(_users: DeviceUser[]): Promise<SyncReport> {
    this.notActivated();
  }
  async readTemplate(_userId: string, _kind: "FACE_TEMPLATE" | "FINGERPRINT_TEMPLATE"): Promise<Template> {
    this.notActivated();
  }
  async writeTemplate(_userId: string, _t: Template): Promise<void> {
    this.notActivated();
  }
  async syncTime(): Promise<void> {
    this.notActivated();
  }
  async health(): Promise<DeviceHealth> {
    return { online: false, lastSeenAt: null, storageFreeKb: null, tamperState: false };
  }
}

export class SupremaDriver extends StubDriver {
  readonly brand = "SUPREMA" as const;
}

export class HikvisionDriver extends StubDriver {
  readonly brand = "HIKVISION" as const;
}
