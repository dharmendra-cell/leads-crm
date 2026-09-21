import { NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { buildWhere, filtersFromParams } from "@/lib/filters";
import { normalizePhone } from "@/lib/phone";
import { getRankingConfig, scoreForLead } from "@/lib/ranking";

const SORTS = {
  score: [{ score: "desc" }, { createdAt: "desc" }],
  newest: [{ createdAt: "desc" }],
  followup: [{ nextFollowUp: { sort: "asc", nulls: "last" } }],
  date: [{ queryDate: { sort: "desc", nulls: "last" } }],
} as const;

export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  const sp = new URL(req.url).searchParams;
  const where = buildWhere(s.oid, filtersFromParams(sp));
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const pageSize = Math.min(100, Number(sp.get("pageSize")) || 25);
  const sort = SORTS[(sp.get("sort") as keyof typeof SORTS) ?? "score"] ?? SORTS.score;
  const [total, leads] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where, orderBy: sort as never, skip: (page - 1) * pageSize, take: pageSize,
      select: { id: true, name: true, company: true, phone: true, email: true, city: true, state: true, source: true, status: true, requirement: true, score: true, callAttempts: true, nextFollowUp: true, queryDate: true, notes: true },
    }),
  ]);
  return NextResponse.json({ total, page, pageSize, leads });
}

/** Manually add a lead (e.g. a direct phone enquiry). */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  const b = (await req.json().catch(() => ({}))) as Record<string, string>;
  const phone = normalizePhone(b.phone);
  if (!phone) return NextResponse.json({ error: "Enter a valid phone number" }, { status: 400 });
  if (await prisma.lead.findFirst({ where: { orgId: s.oid, phone } })) return NextResponse.json({ error: "A lead with this phone already exists" }, { status: 409 });
  const data = {
    orgId: s.oid, source: (b.source || "Direct").slice(0, 60), phone, name: b.name?.slice(0, 200) || null,
    company: b.company?.slice(0, 200) || null, city: b.city?.slice(0, 100) || null,
    requirement: b.requirement?.slice(0, 300) || null, email: b.email?.toLowerCase() || null, queryDate: new Date(),
  };
  const lead = await prisma.lead.create({ data: { ...data, score: scoreForLead(data, await getRankingConfig(s.oid)) } });
  return NextResponse.json(lead, { status: 201 });
}
