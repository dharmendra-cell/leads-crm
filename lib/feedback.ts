import { groq, MODEL } from "./groq";
import { STATUS_KEYS } from "./constants";

/** Rule-based reading of caller remarks (English + Hinglish + common typos). Order = precedence. */
const RULES: [string, RegExp][] = [
  ["LOST", /(purchas|bought|buy|order)\w*.*(from|elsewhere|other|already)|already (purchas|bought|order)|found (a )?(lower|cheaper|less)|lower rate|cheaper|too (costly|expensive)|rate (is )?(high|zyada)|budget nahi|mehnga|mahanga/],
  ["NOT_INTERESTED", /not interest|no (req|requirement|need)|koi req|req(uirement)? nai|req(uirement)? nahi|not required|nahi chahiye|nahi chaiye|don'?t need|do not need|dnd|wrong number|not looking|no use/],
  ["WON", /order (confirm|placed|received)|deal (done|closed)|payment (received|done)|confirmed the order/],
  ["INTERESTED", /interested|requirement hai|req hai|need(s|ed)? (it|this)|will order|send (me )?(quote|price|sample)|price (list|share)|call back|callback|call me|whatsapp|demo|sample (sent|share)|quotation|quote (sent|share)|catalog/],
  ["NOT_PICKED", /not (answer|pick|respond|reach|connect)|no (answer|response)|didn'?t (pick|answer)|switch(ed)? off|out of (reach|coverage)|busy|ringing|nahi utha|nahi uth|call nahi|voicemail|not available|invalid number|call attempted(?! - (in|out)(coming|going), duration)|inva\w* (no|number)|wrong no/],
  ["FOLLOW_UP", /waiting|call (later|back)|baad m|kal (call|bat)|tomorrow|next week|will (call|revert|confirm)|busy hu|thodi der/],
  ["PICKED", /spoke|talked|discussed|bat hui|baat hui|details (share|sent)|shared (the )?details|call attempted.*duration/],
];

export function classifyText(text: string): string | null {
  const t = text.toLowerCase();
  if (/lead was purch\w+\s+no\s+conversa|nothing was discussed|i viewed your|thanks for your enquiry/.test(t)) return "NEW";
  for (const [status, re] of RULES) if (re.test(t)) return status;
  return null;
}

/** Latest meaningful remark decides the status; earlier ones only count as attempts. */
export function inferStatus(feedback: string[]): string | null {
  for (let i = feedback.length - 1; i >= 0; i--) {
    const s = classifyText(feedback[i]);
    if (s && s !== "NEW") return s;
    if (s === "NEW" && i === 0) return "NEW";
  }
  return null;
}

const LLM_BATCH = 25;
const LLM_PARALLEL = 4;
const CALL_TIMEOUT_MS = 12000;
const MAX_TEXT = 220;

/**
 * Groq's free tier limits tokens per minute PER MODEL. groq/compound-mini has ~70k TPM (vs 8k for the others),
 * so it goes first and the rest are fallbacks. Override with CLASSIFY_MODELS="modelA,modelB".
 */
const classifyModels = () =>
  (process.env.CLASSIFY_MODELS?.split(",").map((m) => m.trim()).filter(Boolean) ?? ["groq/compound-mini", "qwen/qwen3.8-27b", "openai/gpt-oss-20b"]).filter(
    (m, i, a) => a.indexOf(m) === i,
  );

/**
 * LLM fallback for remarks the rules could not read. Batches run in parallel and stop being started once
 * `budgetMs` has passed, so a slow/rate-limited model can never push an import past a serverless time limit.
 * A batch that fails (rate limit, bad JSON, timeout) is retried once on the next model.
 * Returns id->status for whatever finished. Never throws.
 */
export async function llmInferStatuses(items: { id: number; text: string }[], budgetMs = 30000): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const client = groq();
  if (!client || !items.length) return out;
  const models = classifyModels();
  const deadline = Date.now() + budgetMs;
  const batches: { id: number; text: string }[][] = [];
  for (let i = 0; i < items.length; i += LLM_BATCH) batches.push(items.slice(i, i + LLM_BATCH).map((it) => ({ id: it.id, text: it.text.slice(0, MAX_TEXT) })));

  const classify = async (model: string, batch: { id: number; text: string }[]) => {
    const res = await client.chat.completions.create(
      {
        model,
        temperature: 0,
        // gpt-oss models "think" first; low effort is plenty for short classification and much faster.
        ...(model.startsWith("openai/gpt-oss") ? ({ reasoning_effort: "low" } as object) : {}),
        max_completion_tokens: 1200,
        ...(model.startsWith("groq/compound") ? {} : { response_format: { type: "json_object" } }),
        messages: [
          {
            role: "user",
            content: `Caller remarks (English/Hindi/Hinglish) from a B2B lead sheet. For each item pick the lead's CURRENT status from: ${STATUS_KEYS.join(", ")}.
NOT_PICKED = call not answered; PICKED = spoke but no decision; INTERESTED = wants price/sample/quote; NOT_INTERESTED = no requirement; LOST = bought elsewhere / price too high; WON = order confirmed; FOLLOW_UP = told to call later.
Respond in JSON only: {"results":[{"id":<id>,"status":"<STATUS>"}]}.
Items: ${JSON.stringify(batch)}`,
          },
        ],
      },
      { timeout: CALL_TIMEOUT_MS, maxRetries: 0 }, // no SDK retries/backoff: worst case = budget + one call
    );
    const raw = res.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1) || "{}");
    let n = 0;
    for (const r of parsed.results ?? []) {
      if (typeof r.id === "number" && STATUS_KEYS.includes(r.status)) {
        out.set(r.id, r.status);
        n++;
      }
    }
    if (!n) throw new Error("model returned no usable results");
  };

  let next = 0;
  const worker = async () => {
    while (next < batches.length && Date.now() < deadline) {
      const idx = next++;
      // Primary model first, then the fallbacks once each, while budget lasts.
      for (let k = 0; k < models.length && Date.now() < deadline; k++) {
        const model = models[k]; // primary first, then fallbacks
        try {
          await classify(model, batches[idx]);
          break;
        } catch (e) {
          console.error(`llmInferStatuses ${model} failed:`, String((e as Error).message).slice(0, 160));
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(LLM_PARALLEL, batches.length) }, worker));
  return out;
}
