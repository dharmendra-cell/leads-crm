const tz = "Asia/Kolkata";
export const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: tz }) : "-";
export const fmtDateTime = (d: string | Date) =>
  new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: tz });
export const isOverdue = (d: string | null | undefined) => !!d && new Date(d).getTime() <= Date.now();
/** yyyy-mm-dd for <input type=date> */
export const toInputDate = (d: string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : "");
