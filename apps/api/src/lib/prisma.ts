/**
 * Client Prisma + middleware d'audit — Plan §07.
 *
 * Le journal d'audit est écrit par un middleware : aucune route ne peut
 * l'oublier. Toute mutation (create/update/delete) sur une entité métier
 * laisse une ligne dans audit_log avec l'avant/après.
 */
import { Prisma, PrismaClient } from "@prisma/client";

export function createPrisma(): PrismaClient {
  const prisma = new PrismaClient();

  prisma.$use(async (params, next) => {
    const mutating = ["create", "update", "delete", "upsert", "updateMany", "deleteMany"];
    if (!params.model || !mutating.includes(params.action)) return next(params);

    // punch est append-only par conception (§06 DESIGN RULE) : toute tentative
    // d'update/delete est refusée ici, ceinture et bretelles sous l'API.
    if (params.model === "Punch" && params.action !== "create") {
      throw new Error(
        "punch est append-only : les corrections passent par punch_correction (Plan §06).",
      );
    }
    if (params.model === "AuditLog") return next(params); // pas d'audit de l'audit

    const delegateKey = params.model.charAt(0).toLowerCase() + params.model.slice(1);
    const before =
      params.action === "update" || params.action === "delete"
        ? await (prisma as unknown as Record<string, { findFirst(o: object): Promise<unknown> }>)[
            delegateKey
          ]?.findFirst({ where: (params.args as { where?: object })?.where ?? {} })
        : null;

    const result = await next(params);

    await prisma.auditLog.create({
      data: {
        action: `${params.model}.${params.action}`,
        entity: params.model,
        entityId: extractId(result) ?? extractId(before),
        beforeJson: before ? JSON.parse(JSON.stringify(before)) : Prisma.JsonNull,
        afterJson: result ? JSON.parse(JSON.stringify(result)) : Prisma.JsonNull,
        // userId injecté via AsyncLocalStorage par le plugin auth (P1).
      },
    });
    return result;
  });

  return prisma;
}

function extractId(row: unknown): string | undefined {
  if (row && typeof row === "object" && "id" in row && typeof (row as { id: unknown }).id === "string") {
    return (row as { id: string }).id;
  }
  return undefined;
}
