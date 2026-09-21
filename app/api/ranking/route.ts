import { NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getRankingConfig, rankingSchema, rankingSuggestions } from "@/lib/ranking";

export async function GET() {
  const s = await getSession();
  if (!s) return unauthorized();
  const [config, suggestions] = await Promise.all([getRankingConfig(s.oid), rankingSuggestions(s.oid)]);
  return NextResponse.json({ config, suggestions });
}

export async function PUT(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  if (s.role !== "ADMIN") return NextResponse.json({ error: "Only an admin can change ranking rules." }, { status: 403 });
  const parsed = rankingSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid ranking rules: " + parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ") }, { status: 400 });
  await prisma.rankingConfig.upsert({
    where: { orgId: s.oid },
    update: { config: JSON.stringify(parsed.data) },
    create: { orgId: s.oid, config: JSON.stringify(parsed.data) },
  });
  return NextResponse.json({ ok: true });
}
