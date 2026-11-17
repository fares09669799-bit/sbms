import crypto from 'crypto';
import { auditLogs } from '../db/schema.ts';
import { db } from '../db/index.ts';

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

let refSeq = 0;

export function generateReference(prefix: string): string {
  refSeq = (refSeq + 1) % 1000;
  const rand = crypto.randomInt(1000, 9999);
  const ts = Date.now().toString().slice(-4);
  return `${prefix}-2026-${ts}${rand}${String(refSeq).padStart(3, '0')}`;
}

export async function recordAuditLog(
  executor: DbOrTx,
  params: {
    userId?: number | null;
    userName: string;
    role: 'OWNER' | 'AGENT';
    operationType: string;
    entityType: string;
    entityId: string;
    affectedRecord: string;
    previousValue?: string;
    newValue: string;
    reference?: string;
  }
) {
  const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const ref = params.reference || generateReference('TX');

  await executor.insert(auditLogs).values({
    reference: ref,
    userId: params.userId ?? null,
    userName: params.userName,
    role: params.role,
    operationType: params.operationType,
    entityType: params.entityType,
    entityId: params.entityId,
    affectedRecord: params.affectedRecord,
    previousValue: params.previousValue ?? null,
    newValue: params.newValue,
    timestamp,
  });

  return ref;
}
