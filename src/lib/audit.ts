import { db } from "./db";
import type { Prisma } from "@prisma/client";

interface AuditParams {
  actor: string; // 'system:daraja-callback', 'admin:<email>', 'customer:<phone>', etc.
  action: string; // 'payment.initiated', 'payment.callback.success', 'entitlement.authorized', ...
  resourceType: string;
  resourceId?: string;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Fire-and-forget from the caller's perspective in terms of control flow,
 * but awaited internally so failures are visible rather than silently
 * swallowed. Audit writes use the same transaction as the state change
 * where the caller passes a transaction client — see usages.
 */
export async function writeAuditLog(
  params: AuditParams,
  tx: Prisma.TransactionClient | typeof db = db
) {
  await tx.auditLog.create({
    data: {
      actor: params.actor,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      metadata: params.metadata,
    },
  });
}
