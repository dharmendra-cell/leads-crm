# Lead CRM

**Turn messy lead spreadsheets into a working sales pipeline.**

Sales teams that buy or collect leads from B2B marketplaces and directories (IndiaMART, TradeIndia, JustDial, Google Maps scrapes, hand-made call sheets) end up with a pile of inconsistent Excel files: different columns, title rows, shifted headers, remarks typed by callers, the same buyer appearing on three platforms. Lead CRM ingests those files as they are, figures out their structure with an LLM plus rules, and gives the team a dashboard and a call workflow to work the leads.

## What it does

- **Upload any workbook.** Every sheet is analysed on its own: header row detection under title rows, headerless and "card-style" (one lead stacked over several lines) layouts, lookup/junk sheets skipped automatically.
- **Automatic column mapping.** An LLM (Groq) maps columns from the headers and 5 sample rows only, never the whole sheet. Rules fill the gaps, and a content check re-detects columns when headers don't match the data. Confirmed layouts are remembered, so repeat uploads need no LLM call.
- **Reads existing call remarks.** Notes like "Not answering", "no requirement", "found a cheaper rate" become call history and set the lead status (rules first, LLM for the unclear ones, English/Hindi/Hinglish).
- **Cleans and de-duplicates.** Phone normalisation (mobiles, landlines, multiple numbers per cell, invisible characters), date parsing, city/state from addresses, and de-duplication across files and platforms. Re-uploading the same sheet never double-counts.
- **Drill-down dashboard.** Overall → platform → state → city → product → month → day, with breadcrumbs. Date range, state, city and search filters apply everywhere.
- **Call progress.** For any split (platform, state, city, month, ...): leads available, called, connected, not picked, not called yet, total attempts.
- **Call workflow.** Log outcomes (not picked, picked, interested, follow-up, not interested, won, lost) with notes, alternate phone and follow-up date. Automatic follow-up rules schedule retries and suggest closing chronically unreachable leads.
- **Ask your leads.** A tool-calling LLM agent answers questions from live data ("how many Indore leads were never called?", "who asked for baby wipes?"), showing which queries it ran. Includes AI-written insights and next actions.
- **Vector search.** Lead text is embedded (384-d) into pgvector for fuzzy, meaning-based search.
- **MCP server.** Expose the CRM to Claude Desktop, Claude Code or any MCP client.
- **Excel export** of any filtered view, including call history.

## Tech stack

Next.js 15 (App Router) · TypeScript · Tailwind CSS 4 · PostgreSQL + pgvector · Prisma · Groq API · MiniLM embeddings · Model Context Protocol SDK · Vitest

## Quick start

```bash
docker compose up -d          # Postgres 16 + pgvector on :5433
cp .env.example .env          # set AUTH_SECRET, DATABASE_URL, GROQ_API_KEY
npm install
npx prisma migrate deploy
npm run dev                   # http://localhost:3000 -> create a workspace
npm test
```

Works without an LLM key using rule-based mapping and status detection; Groq powers smarter mapping, unclear remarks, Ask and insights.

| Variable | Purpose |
|---|---|
| `DATABASE_URL`, `DIRECT_URL` | Postgres (pooled and direct URLs; identical locally) |
| `AUTH_SECRET` | Session signing key, 32+ random characters |
| `GROQ_API_KEY`, `GROQ_MODEL` | LLM access (default `openai/gpt-oss-120b`) |
| `HF_TOKEN` | Hosted embeddings for serverless deploys; if unset, embeddings run locally (or are disabled on Vercel) |
| `ALLOW_REGISTRATION` | Set `false` on public deployments after creating your workspace |

## How an import flows

```
upload -> parse each sheet -> detect content -> map columns (saved layout | LLM | rules)
       -> validate against data -> normalise -> read remarks -> de-duplicate -> save -> embed
```

Every step is logged with timing and shown in the UI. The original row is always kept in `Lead.raw`.

## Project layout

```
app/            pages and API routes (auth, import, leads, stats, ask, insights)
components/     lead table, lead drawer, filter bar
lib/            parse, mapping, importer, feedback, workflow, stats, filters, agent, tools, embeddings
mcp/            MCP server (stdio)
prisma/         schema and migrations
tests/          unit tests covering messy-sheet cases
```

## MCP server

```bash
npx tsx mcp/whoami.ts you@example.com     # prints your workspace id
```

```json
{
  "mcpServers": {
    "lead-crm": {
      "command": "npx",
      "args": ["tsx", "mcp/server.ts"],
      "cwd": "/absolute/path/to/lead-crm",
      "env": { "LEAD_CRM_ORG_ID": "<workspace id>", "LEAD_CRM_ACTOR": "Claude" }
    }
  }
}
```

Tools: `search_leads`, `count_leads`, `semantic_search_leads`, `followups_due`, `get_lead`, `get_insights`, `update_lead_status`, `add_note` (the last two are disabled with `LEAD_CRM_READONLY=1`). The server connects to the same database as the app.

## Deploying for free

See [DEPLOY.md](DEPLOY.md): Vercel (app) + Neon (Postgres with pgvector).

## Limitations

- Email/password auth with a single admin role in practice; roles exist in the schema but there is no team-invite UI yet.
- Imports run inside a request (one request per sheet); very large files would need a background job queue.
- No rate limiting on the auth and LLM endpoints yet, add one before opening to the public.
