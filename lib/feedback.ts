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

const LLM_BATCH = 30;
const LLM_PARALLEL = 4;

/**
 * LLM fallback for remarks the rules could not read. Batches run in parallel and stop being started once
 * `budgetMs` has passed, so a slow/rate-limited model can never push an import past a serverless time limit.
 * Returns id->status for whatever finished. Never throws.
 */
export async function llmInferStatuses(items: { id: number; text: string }[], budgetMs = 20000): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const client = groq();
  if (!client || !items.length) return out;
  const deadline = Date.now() + budgetMs;
  const batches: { id: number; text: string }[][] = [];
  for (let i = 0; i < items.length; i += LLM_BATCH) batches.push(items.slice(i, i + LLM_BATCH));

  let next = 0;
  const worker = async () => {
    while (next < batches.length && Date.now() < deadline) {
      const batch = batches[next++];
      try {
        const res = await client.chat.completions.create({
          model: MODEL,
          temperature: 0,
          // gpt-oss models "think" first; a low effort is plenty for short classification and much faster.
          ...({ reasoning_effort: "low" } as object),
          response_format: { type: "json_object" },
          messages: [
            {
              role: "user",
              content: `Caller remarks (English/Hindi/Hinglish) from a B2B lead sheet. For each item pick the lead's CURRENT status from: ${STATUS_KEYS.join(", ")}.
NOT_PICKED = call not answered; PICKED = spoke but no decision; INTERESTED = wants price/sample/quote; NOT_INTERESTED = no requirement; LOST = bought elsewhere / price too high; WON = order confirmed; FOLLOW_UP = told to call later.
Respond in JSON only: {"results":[{"id":<id>,"status":"<STATUS>"}]}.
Items: ${JSON.stringify(batch)}`,
            },
          ],
        });
        const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}");
        for (const r of parsed.results ?? []) {
          if (typeof r.id === "number" && STATUS_KEYS.includes(r.status)) out.set(r.id, r.status);
        }
      } catch (e) {
        console.error("llmInferStatuses batch failed:", e);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(LLM_PARALLEL, batches.length) }, worker));
  return out;
}
