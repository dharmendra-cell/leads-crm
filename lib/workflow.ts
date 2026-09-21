import { TERMINAL } from "./constants";

export const MAX_NOT_PICKED = 4;

export interface WorkflowResult {
  nextFollowUp: Date | null;
  callAttempts: number;
  autoNote?: string;
  suggestion?: string;
}

function at10am(daysFromNow: number, from = new Date()): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(10, 0, 0, 0);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1); // skip Sunday
  return d;
}

/**
 * Follow-up automation applied when a call outcome is logged.
 * Explicit follow-up dates chosen by the user always win over the automatic ones.
 */
export function applyWorkflow(
  newStatus: string,
  prev: { callAttempts: number; nextFollowUp: Date | null },
  explicitFollowUp?: Date | null,
  now = new Date(),
): WorkflowResult {
  let attempts = prev.callAttempts;
  if (newStatus !== "NEW") attempts += 1;

  if (TERMINAL.includes(newStatus)) {
    return { nextFollowUp: null, callAttempts: attempts, autoNote: "Follow-up cleared (closed)" };
  }
  if (explicitFollowUp) return { nextFollowUp: explicitFollowUp, callAttempts: attempts };

  switch (newStatus) {
    case "NOT_PICKED": {
      const next = at10am(attempts >= 3 ? 2 : 1, now);
      const res: WorkflowResult = {
        nextFollowUp: next,
        callAttempts: attempts,
        autoNote: `Auto follow-up scheduled (attempt ${attempts})`,
      };
      if (attempts >= MAX_NOT_PICKED)
        res.suggestion = `Not picked ${attempts} times - consider marking as Lost or trying WhatsApp/email.`;
      return res;
    }
    case "PICKED":
      return { nextFollowUp: at10am(3, now), callAttempts: attempts, autoNote: "Auto follow-up in 3 days" };
    case "INTERESTED":
      return { nextFollowUp: at10am(2, now), callAttempts: attempts, autoNote: "Auto follow-up in 2 days" };
    default:
      return { nextFollowUp: prev.nextFollowUp, callAttempts: attempts };
  }
}
