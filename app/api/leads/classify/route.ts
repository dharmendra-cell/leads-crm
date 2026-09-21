import { NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { groq } from "@/lib/groq";
import { llmInferStatuses } from "@/lib/feedback";

/** Vercel Hobby allows up to 60s per request. */
export const maxDuration = 60;

const BATCH_LEADS = 100;

/**
 * Classify imported remarks that the import rules could not read. Processes up to 100 leads per call;
 * the UI calls it repeatedly until nothing is pending. Unclassified leads simply stay pending.
 */
export async function POST() {
  const s = await getSession();
  if (!s) return unauthorized();
  if (!groq()) return NextResponse.json({ error: "GROQ_API_KEY is not configured on the server." }, { status: 503 });

  const leads = await prisma.lead.findMany({
    where: { orgId: s.oid, remarkPending: true },
    take: BATCH_LEADS,
    orderBy: { createdAt: "asc" },
    select: { id: true, interactions: { where: { userName: "imported", type: "NOTE" }, orderBy: { createdAt: "desc" }, select: { note: true } } },
  });

  // Latest remark first, so truncation never cuts off the most recent outcome.
  const items = leads.map((l, id) => ({ id, text: l.interactions.map((i) => i.note).filter(Boolean).join(" || ") }));
  const result = await llmInferStatuses(items.filter((i) => i.text), 35000);

  let classified = 0;
  await Promise.all(
    [...result].map(async ([idx, status]) => {
      await prisma.lead.update({ where: { id: leads[idx].id }, data: { status, remarkPending: false } });
      classified++;
    }),
  );
  // Pending leads that have no remark text left cannot be classified; stop them from blocking the queue.
  const empty = items.filter((i) => !i.text).map((i) => leads[i.id].id);
  if (empty.length) await prisma.lead.updateMany({ where: { id: { in: empty } }, data: { remarkPending: false } });

  const remaining = await prisma.lead.count({ where: { orgId: s.oid, remarkPending: true } });
  return NextResponse.json({ processed: leads.length, classified, remaining });
}
