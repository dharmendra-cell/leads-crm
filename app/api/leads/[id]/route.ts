import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { updateLead } from "@/lib/leads";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Ctx) {
  const s = await getSession();
  if (!s) return unauthorized();
  const { id } = await params;
  const lead = await prisma.lead.findFirst({ where: { id, orgId: s.oid }, include: { interactions: { orderBy: { createdAt: "desc" }, take: 50 } } });
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { raw, ...rest } = lead;
  return NextResponse.json({ ...rest, raw: JSON.parse(raw) });
}

const Patch = z.object({
  status: z.string().optional(),
  note: z.string().max(2000).optional(),
  altPhone: z.string().max(30).nullable().optional(),
  phone: z.string().max(30).optional(),
  nextFollowUp: z.string().nullable().optional(),
});

export async function PATCH(req: Request, { params }: Ctx) {
  const s = await getSession();
  if (!s) return unauthorized();
  const { id } = await params;
  const p = Patch.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const { nextFollowUp, ...rest } = p.data;
  try {
    const res = await updateLead(s.oid, id, s.name, {
      ...rest,
      nextFollowUp: nextFollowUp === undefined ? undefined : nextFollowUp ? new Date(nextFollowUp) : null,
    });
    if (!res) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ lead: res.lead, suggestion: res.suggestion });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
