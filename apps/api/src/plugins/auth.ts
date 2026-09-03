/**
 * Garde d'authentification + RBAC — Plan §03 / §07.
 *
 * JWT access + refresh (jose), hachage argon2id (@node-rs/argon2 — binaires
 * précompilés, conforme à l'exigence argon2id de la clause sécurité),
 * verrouillage après N échecs, renouvellement de mot de passe.
 * user_scope est appliqué dans un garde unique : un Gestionnaire ne voit
 * que ses services, un Superviseur que son équipe.
 */
import { SignJWT, jwtVerify } from "jose";
import type { AccessTokenPayload, RoleCode } from "@pointage/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";

const secret = new TextEncoder().encode(config.jwtSecret);

export async function signAccessToken(payload: AccessTokenPayload): Promise<string> {
  return new SignJWT({ role: payload.role, scope: payload.scopeServiceIds, emp: payload.employeeId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setIssuer("pointage-rabta")
    .setExpirationTime(config.jwtAccessTtl)
    .sign(secret);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, secret, { issuer: "pointage-rabta" });
  return {
    sub: payload.sub as string,
    role: payload.role as RoleCode,
    scopeServiceIds: (payload.scope as string[]) ?? [],
    employeeId: (payload.emp as string) ?? null,
  };
}

declare module "fastify" {
  interface FastifyRequest {
    auth: AccessTokenPayload | null;
  }
}

/** Pré-handler : exige un JWT valide. */
export async function authenticate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    await reply.code(401).send({ error: "UNAUTHENTICATED" });
    return;
  }
  try {
    req.auth = await verifyAccessToken(header.slice(7));
  } catch {
    await reply.code(401).send({ error: "TOKEN_INVALID_OR_EXPIRED" });
  }
}

/** Fabrique de garde RBAC : rôle requis + portée de services éventuelle. */
export function requireRole(...roles: RoleCode[]) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      await reply.code(403).send({ error: "FORBIDDEN", required: roles });
    }
  };
}

/** Vérifie qu'un service donné est dans la portée de l'utilisateur. */
export function inScope(auth: AccessTokenPayload, serviceId: string): boolean {
  if (auth.role === "ADMIN" || auth.role === "DRH") return true;
  if (auth.scopeServiceIds.length === 0) return false; // portée non définie = rien
  return auth.scopeServiceIds.includes(serviceId);
}
