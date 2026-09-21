import { groq, MODEL } from "./groq";
import { readTools, toolSpecs, type ReadToolName } from "./tools";
import { getStats } from "./stats";
import { prisma } from "./db";
import { TERMINAL } from "./constants";

export interface AgentResult {
  answer: string;
  trace: { tool: string; args: unknown; rows: number }[];
}

const MAX_STEPS = 5;

export async function askLeads(orgId: string, question: string, history: { role: "user" | "assistant"; content: string }[] = []): Promise<AgentResult> {
  const client = groq();
  if (!client) {
    return { answer: "GROQ_API_KEY is not configured on the server, so the assistant is unavailable. Set it in .env and restart.", trace: [] };
  }
  const sources = await prisma.lead.groupBy({ by: ["source"], where: { orgId }, _count: { _all: true } });
  const system = `You are the analyst inside a lead-management CRM for an Indian B2B business. Leads come from IndiaMART, TradeIndia and other platforms, plus "Direct" queries.
Answer ONLY from tool results; never invent numbers. Call tools as needed (several if useful), then answer concisely in the user's language (Hinglish is fine), with exact counts.
Statuses: NEW, NOT_PICKED (call not picked), PICKED, INTERESTED, FOLLOW_UP, NOT_INTERESTED, WON, LOST. Closed = ${TERMINAL.join(", ")}.
Sources present: ${sources.map((s) => `${s.source} (${s._count._all})`).join(", ") || "none yet"}. Today: ${new Date().toISOString().slice(0, 10)}.
If data is empty, say so plainly.`;

  const messages: any[] = [{ role: "system", content: system }, ...history.slice(-6), { role: "user", content: question }];
  const trace: AgentResult["trace"] = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.1,
      messages,
      tools: toolSpecs,
      tool_choice: "auto",
    });
    const msg = res.choices[0].message;
    if (!msg.tool_calls?.length) return { answer: msg.content?.trim() || "I could not produce an answer.", trace };

    messages.push(msg);
    for (const call of msg.tool_calls) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(call.function.arguments || "{}"); } catch { /* model sent bad JSON */ }
      const fn = readTools[call.function.name as ReadToolName];
      const out = fn ? await fn(orgId, args) : { error: `Unknown tool ${call.function.name}` };
      trace.push({ tool: call.function.name, args, rows: Array.isArray(out) ? out.length : 1 });
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(out).slice(0, 12000) });
    }
  }
  return { answer: "I needed too many steps to answer that. Try a narrower question.", trace };
}

export async function generateInsights(orgId: string): Promise<{ insights: string; facts: unknown; usedLlm: boolean }> {
  const [overall, stale, dueRows] = await Promise.all([
    getStats(orgId, {}),
    prisma.lead.count({ where: { orgId, status: "NOT_PICKED", callAttempts: { gte: 3 } } }),
    prisma.lead.count({ where: { orgId, nextFollowUp: { lte: new Date() }, status: { notIn: TERMINAL } } }),
  ]);
  // Per-source funnel for conversion comparison
  const perSource = await Promise.all(
    overall.breakdowns.source.map(async (s) => {
      const st = await getStats(orgId, { source: s.key });
      return { source: s.key, total: st.kpis.total, contacted: st.kpis.contacted, interested: st.kpis.interested, won: st.kpis.won, topCities: st.breakdowns.city.slice(0, 3), topProducts: st.breakdowns.requirement.slice(0, 3) };
    }),
  );
  const facts = { overall: overall.kpis, perSource, overdueFollowUps: dueRows, notPickedThreeTimesPlus: stale };

  const client = groq();
  if (!overall.kpis.total) return { insights: "No leads yet - upload a sheet first.", facts, usedLlm: false };
  if (!client) {
    const lines = perSource.map((p) => `- ${p.source}: ${p.total} leads, ${p.contacted} contacted, ${p.interested} interested, ${p.won} won`);
    return { insights: `${lines.join("\n")}\n- ${dueRows} follow-ups overdue, ${stale} leads not picked 3+ times.\n(Set GROQ_API_KEY for AI-written insights.)`, facts, usedLlm: false };
  }
  const res = await client.chat.completions.create({
    model: MODEL,
    temperature: 0.2,
    messages: [
      { role: "system", content: "You are a sales-ops analyst. From the JSON facts only, write 5 short bullet insights and 3 concrete next actions for the caller team. Compare sources, flag overdue follow-ups and hot untouched leads. Use exact numbers, no invention. Hinglish is fine. Markdown bullets." },
      { role: "user", content: JSON.stringify(facts) },
    ],
  });
  return { insights: res.choices[0].message.content ?? "", facts, usedLlm: true };
}
