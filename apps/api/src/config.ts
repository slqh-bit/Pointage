/** Configuration — tout passe par des variables d'environnement (12-factor). */
export const config = {
  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST ?? "0.0.0.0",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  jwtSecret: process.env.JWT_SECRET ?? "dev-only-secret-change-me-0123456789",
  jwtAccessTtl: process.env.JWT_ACCESS_TTL ?? "15m",
  jwtRefreshTtl: process.env.JWT_REFRESH_TTL ?? "30d",
  passwordMinLength: Number(process.env.PASSWORD_MIN_LENGTH ?? 10),
  passwordMaxAgeDays: Number(process.env.PASSWORD_MAX_AGE_DAYS ?? 90),
  lockoutThreshold: Number(process.env.LOCKOUT_THRESHOLD ?? 5),
  lockoutMinutes: Number(process.env.LOCKOUT_MINUTES ?? 15),
  templateBridgeUrl: process.env.TEMPLATE_BRIDGE_URL ?? "",
} as const;
