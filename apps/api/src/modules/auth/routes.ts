/**
 * Module auth — Plan §03 / P1.
 * Login (argon2id, verrouillage, politique de renouvellement), refresh.
 */
import { hash, verify } from "@node-rs/argon2";
import { LoginSchema } from "@pointage/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../../config.js";
import { signAccessToken } from "../../plugins/auth.js";

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/v1/auth/login", async (req, reply) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues });
    const { username, password } = parsed.data;

    const user = await app.prisma.user.findUnique({ where: { username }, include: { role: true, scopes: true } });
    if (!user || !user.isActive) return reply.code(401).send({ error: "INVALID_CREDENTIALS" });

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      return reply.code(423).send({ error: "ACCOUNT_LOCKED", lockedUntil: user.lockedUntil });
    }

    const ok = await verify(user.passwordHash, password).catch(() => false);
    if (!ok) {
      const attempts = user.failedAttempts + 1;
      await app.prisma.user.update({
        where: { id: user.id },
        data: {
          failedAttempts: attempts,
          lockedUntil: attempts >= config.lockoutThreshold
            ? new Date(Date.now() + config.lockoutMinutes * 60_000)
            : null,
        },
      });
      return reply.code(401).send({ error: "INVALID_CREDENTIALS" });
    }

    const passwordAgeMs = Date.now() - user.passwordChangedAt.getTime();
    const mustChangePassword = passwordAgeMs > config.passwordMaxAgeDays * 86_400_000;

    await app.prisma.user.update({
      where: { id: user.id },
      data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    const accessToken = await signAccessToken({
      sub: user.id,
      role: user.role.code as never,
      scopeServiceIds: user.scopes.map((s) => s.serviceId).filter((x): x is string => x !== null),
      employeeId: user.employeeId,
    });

    return reply.send({
      accessToken,
      mustChangePassword,
      user: {
        id: user.id,
        username: user.username,
        role: user.role.code,
        employeeId: user.employeeId,
      },
    });
  });

  /** Changement de mot de passe — complexité exigée par la clause sécurité. */
  app.post("/api/v1/auth/change-password", async (req, reply) => {
    const Body = z.object({
      username: z.string().min(1),
      oldPassword: z.string().min(1),
      newPassword: z.string().min(config.passwordMinLength),
    });
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });
    const { username, oldPassword, newPassword } = parsed.data;

    const user = await app.prisma.user.findUnique({ where: { username } });
    if (!user) return reply.code(404).send({ error: "USER_NOT_FOUND" });
    const ok = await verify(user.passwordHash, oldPassword).catch(() => false);
    if (!ok) return reply.code(401).send({ error: "INVALID_CREDENTIALS" });

    await app.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hash(newPassword), passwordChangedAt: new Date() },
    });
    return reply.send({ ok: true });
  });
}
