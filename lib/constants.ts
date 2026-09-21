export const STATUSES = [
  { key: "NEW", label: "New", color: "bg-slate-200 text-slate-800" },
  { key: "NOT_PICKED", label: "Call not picked", color: "bg-amber-100 text-amber-800" },
  { key: "PICKED", label: "Picked", color: "bg-sky-100 text-sky-800" },
  { key: "INTERESTED", label: "Interested", color: "bg-emerald-100 text-emerald-800" },
  { key: "FOLLOW_UP", label: "Follow-up", color: "bg-violet-100 text-violet-800" },
  { key: "NOT_INTERESTED", label: "Not interested", color: "bg-rose-100 text-rose-800" },
  { key: "WON", label: "Won", color: "bg-green-200 text-green-900" },
  { key: "LOST", label: "Lost", color: "bg-zinc-300 text-zinc-800" },
] as const;

export const STATUS_KEYS = STATUSES.map((s) => s.key) as string[];
export const TERMINAL = ["NOT_INTERESTED", "WON", "LOST"];
export const statusLabel = (k: string) => STATUSES.find((s) => s.key === k)?.label ?? k;
export const statusColor = (k: string) => STATUSES.find((s) => s.key === k)?.color ?? "bg-slate-200";

export const KNOWN_SOURCES = ["IndiaMART", "TradeIndia", "ExportersIndia", "JustDial", "Direct"];

// Dimensions a user can drill down / split by (order = order of cards on the dashboard).
export const DIMENSIONS = ["source", "status", "state", "city", "requirement", "month", "day"] as const;
export type Dimension = (typeof DIMENSIONS)[number];
export const DIM_LABEL: Record<Dimension, string> = {
  source: "Source",
  status: "Status",
  state: "State",
  city: "City",
  requirement: "Product / requirement",
  month: "Month (enquiry date)",
  day: "Day (enquiry date)",
};
export const DATE_DIMS: readonly Dimension[] = ["month", "day"];

/** Platform groups for the Leads page filter. "Direct" = IndiaMART direct enquiries + manually added direct leads. */
export const SOURCE_GROUPS = [
  { key: "IndiaMART", label: "IndiaMART", match: ["IndiaMART"] },
  { key: "TradeIndia", label: "TradeIndia", match: ["TradeIndia"] },
  { key: "JustDial", label: "JustDial", match: ["JustDial"] },
  { key: "Direct", label: "Direct", match: ["IndiaMART Direct", "Direct"] },
] as const;
export const OTHER_SOURCE = "Other";
const GROUPED = SOURCE_GROUPS.flatMap((g) => g.match as readonly string[]);

/** Which filter chip a concrete source name belongs to. */
export const groupOfSource = (source: string): string =>
  SOURCE_GROUPS.find((g) => (g.match as readonly string[]).includes(source))?.key ?? OTHER_SOURCE;
export const knownSourceNames = () => [...GROUPED];

/** Import records created by "Paste leads" use this file name; everything else is a sheet upload. */
export const PASTED_LEADS_NAME = "Pasted leads";
