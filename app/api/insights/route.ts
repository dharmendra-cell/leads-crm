import { NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth";
import { generateInsights } from "@/lib/agent";

/** Vercel Hobby allows up to 60s per request. */
export const maxDuration = 60;

export async function POST() {
  const s = await getSession();
  if (!s) return unauthorized();
  try {
    return NextResponse.json(await generateInsights(s.oid));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Could not generate insights right now." }, { status: 502 });
  }
}
