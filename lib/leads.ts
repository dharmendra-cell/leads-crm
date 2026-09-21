import { prisma } from "./db";
import { STATUS_KEYS } from "./constants";
import { applyWorkflow } from "./workflow";
import { normalizePhone } from "./phone";

export interface UpdateInput {
  status?: string;
  note?: string;
  altPhone?: string | null;
  phone?: string | null;
  nextFollowUp?: Date | null;
}

/** Single write path for call outcomes: used by the web UI and the MCP server. */
export async function updateLead(orgId: string, leadId: string, userName: string, input: UpdateInput) {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, orgId } });
  if (!lead) return null;
  if (input.status && !STATUS_KEYS.includes(input.status)) throw new Error(`Invalid status ${input.status}`);

  const data: Record<string, unknown> = {};
  const logs: { type: string; outcome?: string; note?: string }[] = [];
  let suggestion: string | undefined;

  if (input.altPhone !== undefined) data.altPhone = input.altPhone ? normalizePhone(input.altPhone) ?? input.altPhone : null;
  if (input.phone) {
    const p = normalizePhone(input.phone);
    if (!p) throw new Error("Invalid phone number");
    data.phone = p;
  }

  if (input.status) {
    const w = applyWorkflow(input.status, lead, input.nextFollowUp);
    data.status = input.status;
    data.callAttempts = w.callAttempts;
    data.nextFollowUp = w.nextFollowUp;
    suggestion = w.suggestion;
    logs.push({ type: "STATUS", outcome: input.status, note: input.note?.trim() || undefined });
    if (w.autoNote) logs.push({ type: "SYSTEM", note: w.autoNote });
  } else {
    if (input.nextFollowUp !== undefined) data.nextFollowUp = input.nextFollowUp;
    if (input.note?.trim()) logs.push({ type: "NOTE", note: input.note.trim() });
  }
  if (input.note?.trim()) data.notes = input.note.trim();

  const updated = await prisma.lead.update({
    where: { id: leadId },
    data: {
      ...data,
      interactions: { create: logs.map((l) => ({ ...l, orgId, userName })) },
    },
  });
  return { lead: updated, suggestion };
}
