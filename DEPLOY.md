# Free deployment: Vercel + Neon

Total cost: 0. No credit card needed for any of these.

## 1. Database (Neon)

1. Sign up at https://neon.tech and create a project (region: Singapore is closest to India).
2. On the dashboard, copy two connection strings:
   - **Pooled** (host contains `-pooler`) -> `DATABASE_URL`
   - **Direct** (toggle "Pooled connection" off) -> `DIRECT_URL`
3. The `vector` extension is created by the first migration automatically.

## 2. Code on GitHub

```bash
cd lead-crm
git init && git add -A && git commit -m "Initial commit"
# create an empty repo on github.com, then:
git remote add origin https://github.com/<you>/lead-crm.git
git push -u origin main
```

`.env` is gitignored; never commit keys.

## 3. App (Vercel)

1. https://vercel.com -> Add New Project -> import the GitHub repo (framework: Next.js, auto-detected).
2. Environment variables:

| Name | Value |
|---|---|
| `DATABASE_URL` | Neon pooled URL (add `&pgbouncer=true` if not present) |
| `DIRECT_URL` | Neon direct URL |
| `AUTH_SECRET` | output of `openssl rand -base64 32` |
| `GROQ_API_KEY` | your Groq key (create a fresh one for production) |
| `GROQ_MODEL` | `openai/gpt-oss-120b` |
| `HF_TOKEN` | optional: free token from huggingface.co/settings/tokens (enables semantic search on Vercel) |

3. Deploy. The build runs `prisma migrate deploy` then `next build`.
4. Open the URL, click "Create a workspace", make your account.
5. **Then close sign-ups:** add `ALLOW_REGISTRATION=false` in Vercel env vars and redeploy. Otherwise anyone with the link can create a workspace.

## Free-tier limits to know

- Vercel Hobby: 60s per request, 4.5MB request body (files above ~4MB will fail to upload; split them), personal/non-commercial use only per Vercel's terms.
- Neon free: 0.5GB storage, database sleeps when idle (first request after a pause takes a second or two).
- Groq free: per-minute request limits; large imports fall back to rules if the limit is hit.
- Without `HF_TOKEN`, semantic search and the "similar leads" part of Ask are disabled on Vercel; everything else works.

## MCP against the deployed database

The MCP server runs on your machine and connects straight to Neon: set `DATABASE_URL` to the Neon URL in the MCP config `env`
together with `LEAD_CRM_ORG_ID`.
