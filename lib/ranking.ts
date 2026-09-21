import { z } from "zod";
import { prisma } from "./db";

/**
 * Business-specific lead ranking. Score (0-100) = contact quality + freshness + business fit:
 *   contact  (max 45): phone 20, email 8, company 6, requirement 6, message 5
 *   recency  (max 10)
 *   product  (-30..+30): weights of your product keywords found in the requirement/message
 *   quantity (0..15): tiers on the biggest quantity mentioned ("3000 Piece", "50 packs")
 *   location (-15..+15): weight of the first matching priority city/state
 *   source   (-15..+15): weight per platform
 * Everything is configurable per workspace on the Ranking page.
 */
export const rankingSchema = z.object({
  products: z.array(z.object({ keyword: z.string().trim().min(2).max(60), weight: z.number().min(-30).max(30) })).max(100),
  unmatchedPenalty: z.number().min(-30).max(0),
  quantityTiers: z.array(z.object({ min: z.number().int().min(1).max(10_000_000), points: z.number().min(0).max(15) })).max(10),
  locations: z.array(z.object({ name: z.string().trim().min(2).max(60), weight: z.number().min(-15).max(15) })).max(100),
  sources: z.array(z.object({ source: z.string().trim().min(1).max(60), weight: z.number().min(-15).max(15) })).max(30),
  hotThreshold: z.number().int().min(1).max(100),
});
export type RankingConfig = z.infer<typeof rankingSchema>;

export const DEFAULT_RANKING: RankingConfig = {
  products: [],
  unmatchedPenalty: 0,
  quantityTiers: [{ min: 1000, points: 15 }, { min: 100, points: 10 }, { min: 20, points: 5 }],
  locations: [],
  sources: [],
  hotThreshold: 60,
};

export async function getRankingConfig(orgId: string): Promise<RankingConfig> {
  const row = await prisma.rankingConfig.findUnique({ where: { orgId } });
  if (!row) return DEFAULT_RANKING;
  const parsed = rankingSchema.safeParse(JSON.parse(row.config));
  return parsed.success ? parsed.data : DEFAULT_RANKING;
}

export interface ScorableLead {
  phone?: string | null; email?: string | null; company?: string | null; requirement?: string | null; message?: string | null;
  queryDate?: Date | null; city?: string | null; state?: string | null; source?: string | null;
}
export interface ScorePart { label: string; points: number; detail?: string }

const UNIT = /(\d[\d,]*)\s*(?:pcs|pc|pieces?|packs?|pkts?|packets?|boxes|box|cartons?|ctns?|rolls?|units?|nos|sets?|kgs?|bottles?|dozens?|cases?)\b/gi;

/** Biggest quantity mentioned in the text ("Wet Wipes-3000 Piece" -> 3000). Units are not converted. */
export function parseQuantity(text: string): number | null {
  let best: number | null = null;
  for (const m of text.matchAll(UNIT)) {
    const n = Number(m[1].replace(/,/g, ""));
    if (n > 0 && n < 100_000_000 && (best === null || n > best)) best = n;
  }
  return best;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const norm = (s?: string | null) => (s ?? "").toLowerCase().trim();

export function scoreWithBreakdown(lead: ScorableLead, cfg: RankingConfig = DEFAULT_RANKING, now = new Date()): { total: number; parts: ScorePart[] } {
  const parts: ScorePart[] = [];
  const add = (label: string, points: number, detail?: string) => points !== 0 && parts.push({ label, points, detail });

  add("Phone", lead.phone ? 20 : 0);
  add("Email", lead.email ? 8 : 0);
  add("Company", lead.company ? 6 : 0);
  add("Requirement given", lead.requirement ? 6 : 0);
  add("Detailed message", lead.message && lead.message.length > 30 ? 5 : 0);

  if (lead.queryDate) {
    const days = (now.getTime() - lead.queryDate.getTime()) / 86400_000;
    add("Recent enquiry", days <= 7 ? 10 : days <= 30 ? 6 : days <= 90 ? 3 : 0, `${Math.max(0, Math.round(days))} days old`);
  }

  const text = `${norm(lead.requirement)} ${norm(lead.message)}`;
  if (cfg.products.length) {
    const hits = cfg.products.filter((p) => text.includes(p.keyword.toLowerCase()));
    if (hits.length) {
      const sum = clamp(hits.reduce((a, p) => a + p.weight, 0), -30, 30);
      add("Product match", sum, hits.map((h) => h.keyword).join(", "));
    } else if (text.trim()) add("No product you sell", cfg.unmatchedPenalty);
  }

  const qty = parseQuantity(`${lead.requirement ?? ""} ${lead.message ?? ""}`);
  if (qty !== null && cfg.quantityTiers.length) {
    const tier = [...cfg.quantityTiers].sort((a, b) => b.min - a.min).find((t) => qty >= t.min);
    if (tier) add("Order quantity", tier.points, `${qty.toLocaleString("en-IN")} units asked`);
  }

  const place = [norm(lead.city), norm(lead.state)].filter(Boolean);
  if (place.length && cfg.locations.length) {
    const hit = cfg.locations.find((l) => place.some((p) => p === l.name.toLowerCase() || p.includes(l.name.toLowerCase())));
    if (hit) add("Location", hit.weight, hit.name);
  }

  const src = cfg.sources.find((s) => s.source.toLowerCase() === norm(lead.source));
  if (src) add("Source", src.weight, src.source);

  return { total: clamp(Math.round(parts.reduce((a, p) => a + p.points, 0)), 0, 100), parts };
}

export const scoreForLead = (lead: ScorableLead, cfg: RankingConfig = DEFAULT_RANKING, now = new Date()) => scoreWithBreakdown(lead, cfg, now).total;

const STOP = new Set("looking suppliers supplier required requirement buy need want quote price piece pieces pack packs packet packets box boxes with from that this your for and the size type new inquiry enquiry product products india plain white good quality high grade small large medium mini".split(" "));

/** Frequent product words / places / sources in this workspace, to click-add on the Ranking page. */
export async function rankingSuggestions(orgId: string) {
  const [reqs, cities, states, sources] = await Promise.all([
    prisma.lead.groupBy({ by: ["requirement"], where: { orgId, requirement: { not: null } }, _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["city"], where: { orgId, city: { not: null } }, _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["state"], where: { orgId, state: { not: null } }, _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["source"], where: { orgId }, _count: { _all: true } }),
  ]);
  const words = new Map<string, number>();
  for (const r of reqs) {
    const toks = (r.requirement ?? "").toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w));
    const seen = new Set<string>();
    for (let i = 0; i < toks.length; i++) {
      for (const g of [toks[i], toks[i + 1] ? `${toks[i]} ${toks[i + 1]}` : null]) if (g && !seen.has(g)) { seen.add(g); words.set(g, (words.get(g) ?? 0) + r._count._all); }
    }
  }
  const top = <T extends { _count: { _all: number } }>(a: T[], key: (x: T) => string, n: number) =>
    a.sort((x, y) => y._count._all - x._count._all).slice(0, n).map((x) => ({ name: key(x), count: x._count._all }));
  return {
    words: [...words].filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([name, count]) => ({ name, count })),
    cities: top(cities, (x) => x.city as string, 20),
    states: top(states, (x) => x.state as string, 15),
    sources: top(sources, (x) => x.source, 12),
  };
}

/** Re-score every lead of a workspace with its current rules. Returns counts. */
export async function rescoreAll(orgId: string): Promise<{ leads: number; top: number }> {
  const cfg = await getRankingConfig(orgId);
  const leads = await prisma.lead.findMany({
    where: { orgId },
    select: { id: true, phone: true, email: true, company: true, requirement: true, message: true, queryDate: true, city: true, state: true, source: true },
  });
  const byScore = new Map<number, string[]>();
  let top = 0;
  const now = new Date();
  for (const l of leads) {
    const sc = scoreForLead(l, cfg, now);
    top = Math.max(top, sc);
    (byScore.get(sc) ?? byScore.set(sc, []).get(sc)!).push(l.id);
  }
  // At most 101 UPDATEs (one per distinct score) instead of one per lead.
  for (const [score, ids] of byScore) {
    for (let i = 0; i < ids.length; i += 5000) await prisma.lead.updateMany({ where: { id: { in: ids.slice(i, i + 5000) } }, data: { score } });
  }
  return { leads: leads.length, top };
}
