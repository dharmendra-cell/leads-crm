/**
 * Lead CRM MCP server (stdio). Lets Claude Desktop / Claude Code / any MCP client query and update your leads.
 *
 *   LEAD_CRM_ORG_ID=<org id>  DATABASE_URL=...  npx tsx mcp/server.ts
 *
 * Find your org id with: npx tsx mcp/whoami.ts <your-email>
 * Read tools are always on. Write tools (update_lead_status, add_note) are enabled unless LEAD_CRM_READONLY=1.
 * All logging goes to stderr - stdout is reserved for the MCP protocol.
 */
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { prisma } from "../lib/db";
import { readTools } from "../lib/tools";
import { updateLead } from "../lib/leads";
import { generateInsights } from "../lib/agent";
import { STATUS_KEYS } from "../lib/constants";

const orgId = process.env.LEAD_CRM_ORG_ID;
if (!orgId) {
  console.error("LEAD_CRM_ORG_ID is required. Run: npx tsx mcp/whoami.ts <email>");
  process.exit(1);
}
const readonly = process.env.LEAD_CRM_READONLY === "1";
const actor = process.env.LEAD_CRM_ACTOR || "MCP";

const text = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });

const filters = {
  source: z.string().optional().describe("e.g. IndiaMART, TradeIndia, JustDial, Google Maps, Direct"),
  status: z.enum(STATUS_KEYS as [string, ...string[]]).optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  requirement: z.string().optional().describe("Exact product/requirement value"),
  q: z.string().optional().describe("Free-text match on name, company, phone, email, requirement"),
};

const server = new McpServer({ name: "lead-crm", version: "1.0.0" });

server.registerTool(
  "search_leads",
  { description: "List leads matching filters, best score first.", inputSchema: { ...filters, limit: z.number().int().min(1).max(50).optional() } },
  async (a) => text(await readTools.list_leads(orgId, a)),
);

server.registerTool(
  "count_leads",
  {
    description: "Count leads grouped by a field (source, status, city, state, requirement), optionally filtered. Use for any how-many question.",
    inputSchema: { group_by: z.enum(["source", "status", "city", "state", "requirement"]), ...filters },
  },
  async (a) => text(await readTools.aggregate_leads(orgId, a)),
);

server.registerTool(
  "semantic_search_leads",
  { description: "Vector (pgvector) similarity search over what leads asked for. Use for fuzzy topics, e.g. 'bulk baby wipes for hospitals'.", inputSchema: { query: z.string(), limit: z.number().int().min(1).max(50).optional() } },
  async (a) => text(await readTools.semantic_search(orgId, a)),
);

server.registerTool(
  "followups_due",
  { description: "Leads whose follow-up date has arrived and are not closed.", inputSchema: { ...filters, limit: z.number().int().min(1).max(50).optional() } },
  async (a) => text(await readTools.followups_due(orgId, a)),
);

server.registerTool(
  "get_lead",
  { description: "Full details and call history of one lead.", inputSchema: { id: z.string() } },
  async (a) => text(await readTools.get_lead(orgId, a)),
);

server.registerTool(
  "get_insights",
  { description: "AI-written summary: source comparison, overdue follow-ups, next actions.", inputSchema: {} },
  async () => text((await generateInsights(orgId)).insights),
);

if (!readonly) {
  server.registerTool(
    "update_lead_status",
    {
      description: "Log a call outcome. Applies follow-up automation (e.g. Not picked -> retry next day). Confirm with the user before bulk changes.",
      inputSchema: {
        id: z.string(),
        status: z.enum(STATUS_KEYS as [string, ...string[]]),
        note: z.string().max(2000).optional(),
        next_follow_up: z.string().optional().describe("ISO date, overrides the automatic follow-up"),
      },
    },
    async (a) => {
      const res = await updateLead(orgId, a.id, actor, { status: a.status, note: a.note, nextFollowUp: a.next_follow_up ? new Date(a.next_follow_up) : undefined });
      return text(res ? { id: res.lead.id, status: res.lead.status, nextFollowUp: res.lead.nextFollowUp, suggestion: res.suggestion } : { error: "Lead not found" });
    },
  );
  server.registerTool(
    "add_note",
    { description: "Add a note to a lead without changing its status.", inputSchema: { id: z.string(), note: z.string().min(1).max(2000) } },
    async (a) => text((await updateLead(orgId, a.id, actor, { note: a.note })) ? "Note added" : { error: "Lead not found" }),
  );
}

async function main() {
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) {
    console.error(`No organization with id ${orgId}`);
    process.exit(1);
  }
  await server.connect(new StdioServerTransport());
  console.error(`lead-crm MCP ready for "${org.name}"${readonly ? " (read-only)" : ""}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
