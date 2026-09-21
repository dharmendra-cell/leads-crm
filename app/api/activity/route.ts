import { NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth";
import { callActivity, defaultRange, type Period } from "@/lib/activity";

const isDay = (v: string | null) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(`${v}T00:00:00+05:30`));

export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  const sp = new URL(req.url).searchParams;
  const period: Period = (["day", "week", "month"] as const).includes(sp.get("period") as Period) ? (sp.get("period") as Period) : "day";
  const def = defaultRange(period);
  const from = isDay(sp.get("from")) ? new Date(`${sp.get("from")}T00:00:00+05:30`) : def.from;
  const to = isDay(sp.get("to")) ? new Date(new Date(`${sp.get("to")}T00:00:00+05:30`).getTime() + 86400_000) : def.to;
  const data = await callActivity(s.oid, { period, from, to, user: sp.get("user") || undefined });
  return NextResponse.json({ period, from, to, ...data });
}
