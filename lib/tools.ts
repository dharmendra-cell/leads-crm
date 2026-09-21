import { prisma } from "./db";
import { buildWhere, type Filters } from "./filters";
import { embedPendingLeads, semanticSearch } from "./embeddings";

const GROUPABLE = ["source", "status", "city", "state", "requirement"] as const;
const FILTER_KEYS = ["source", "status", "city", "state", "requirement", "q"] as const;

const clampLimit = (n: unknown, def = 10) => Math.min(Math.max(Number(n) || def, 1), 50);
const pickFilters = (a: Record<string, unknown>): Filters => {
  const f: Filters = {};
  // Product names in sheets are messy ("Baby Wipes-200 Pack"), so a requirement given to a tool is a keyword search, not an exact match.
  if (typeof a.requirement === "string" && a.requirement && !a.q) a = { ...a, q: a.requirement, requirement: undefined };
  for (const k of FILTER_KEYS) if (typeof a[k] === "string" && a[k]) (f as Record<string, unknown>)[k] = a[k];
  if (a.due === true) f.due = true;
  return f;
};

const LEAD_SELECT = {
  id: true, name: true, company: true, phone: true, city: true, source: true, status: true,
  requirement: true, score: true, callAttempts: true, nextFollowUp: true, queryDate: true,
} as const;

/** Read-only lead tools shared by the in-app Groq agent and the MCP server. */
export const readTools = {
  async aggregate_leads(orgId: string, a: Record<string, unknown>) {
    const by = GROUPABLE.find((g) => g === a.group_by);
    if (!by) return { error: `group_by must be one of ${GROUPABLE.join(", ")}` };
    const rows = (await prisma.lead.groupBy({
      by: [by] as never,
      where: buildWhere(orgId, pickFilters(a)),
      _count: { _all: true },
    } as never)) as unknown as Array<Record<string, string | null> & { _count: { _all: number } }>;
    return rows
      .map((r) => ({ [by]: r[by] ?? "(blank)", count: r._count._all }))
      .sort((x, y) => y.count - x.count)
      .slice(0, 25);
  },

  async list_leads(orgId: string, a: Record<string, unknown>) {
    const leads = await prisma.lead.findMany({
      where: buildWhere(orgId, pickFilters(a)),
      select: LEAD_SELECT,
      orderBy: [{ score: "desc" }, { createdAt: "desc" }],
      take: clampLimit(a.limit),
    });
    return leads;
  },

  async followups_due(orgId: string, a: Record<string, unknown>) {
    return prisma.lead.findMany({
      where: buildWhere(orgId, { ...pickFilters(a), due: true }),
      select: LEAD_SELECT,
      orderBy: { nextFollowUp: "asc" },
      take: clampLimit(a.limit, 20),
    });
  },

  async semantic_search(orgId: string, a: Record<string, unknown>) {
    const query = String(a.query ?? "").trim();
    if (!query) return { error: "query is required" };
    await embedPendingLeads(orgId);
    const hits = await semanticSearch(orgId, query, clampLimit(a.limit));
    return hits ?? { error: "Semantic search unavailable (embedding model could not load)" };
  },

  async get_lead(orgId: string, a: Record<string, unknown>) {
    const lead = await prisma.lead.findFirst({
      where: { orgId, id: String(a.id ?? "") },
      include: { interactions: { orderBy: { createdAt: "desc" }, take: 20 } },
    });
    if (!lead) return { error: "Lead not found" };
    const { raw: _raw, ...rest } = lead;
    void _raw;
    return rest;
  },
};

export type ReadToolName = keyof typeof readTools;

const filterProps = {
  source: { type: "string", description: "Lead source e.g. IndiaMART, TradeIndia, Direct" },
  status: { type: "string", description: "NEW, NOT_PICKED, PICKED, INTERESTED, FOLLOW_UP, NOT_INTERESTED, WON, LOST" },
  city: { type: "string" },
  state: { type: "string" },
  requirement: { type: "string", description: "Product keyword, e.g. baby wipes (matched loosely, case-insensitive)" },
  q: { type: "string", description: "Free-text match on name, company, phone, email, requirement" },
};

/** OpenAI/Groq-style tool specs. */
export const toolSpecs = [
  {
    type: "function" as const,
    function: {
      name: "aggregate_leads",
      description: "Count leads grouped by a field, optionally filtered. Use for any 'how many' / 'which city/source has most' question.",
      parameters: {
        type: "object",
        properties: { group_by: { type: "string", enum: [...GROUPABLE] }, ...filterProps },
        required: ["group_by"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_leads",
      description: "List individual leads (highest score first). Use for 'show me', 'who' questions.",
      parameters: { type: "object", properties: { ...filterProps, limit: { type: "number" } } },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "followups_due",
      description: "Leads whose follow-up date has arrived (overdue or due today) and are not closed.",
      parameters: { type: "object", properties: { ...filterProps, limit: { type: "number" } } },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "semantic_search",
      description: "Vector search over lead requirement/message text. Use for fuzzy topic questions, e.g. 'buyers asking for bulk export packaging'.",
      parameters: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] },
    },
  },
];
