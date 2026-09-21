import { NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth";
import { askLeads } from "@/lib/agent";

/** Vercel Hobby allows up to 60s per request. */
export const maxDuration = 60;

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  const { question, history } = (await req.json().catch(() => ({}))) as { question?: string; history?: { role: "user" | "assistant"; content: string }[] };
  if (!question?.trim()) return NextResponse.json({ error: "Ask a question" }, { status: 400 });
  try {
    return NextResponse.json(await askLeads(s.oid, question.slice(0, 1000), history ?? []));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "The assistant failed (Groq rate limit or network). Try again in a moment." }, { status: 502 });
  }
}
