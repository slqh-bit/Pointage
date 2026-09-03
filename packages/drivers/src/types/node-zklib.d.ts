/**
 * Déclaration ambiante pour node-zklib (MIT, sans types publiés).
 * Chargé dynamiquement par ZktecoDriver — la dépendance reste optionnelle.
 */
declare module "node-zklib" {
  export default class ZKLib {
    constructor(ip: string, port: number, timeout: number, inport: number);
    createSocket(): Promise<void>;
    getAttendances(): Promise<{ data: Array<{ userId: string; recordTime: string | Date }> }>;
    getUsers(): Promise<{ data: Array<{ userId: string; name: string }> }>;
    setUser(uid: number, userId: string, name: string, password: string, role: number, cardno: number): Promise<void>;
    getDeviceInfo?(): Promise<Record<string, unknown>>;
    setTime?(t: Date): Promise<void>;
    disconnect(): Promise<void>;
  }
}
