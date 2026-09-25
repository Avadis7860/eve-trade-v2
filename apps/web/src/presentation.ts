import type { ApiOpportunitySummary } from "@eve-trade/contracts";

export type WebEvidenceState =
  | "COMPLETE"
  | "PARTIAL"
  | "ERROR"
  | "UNKNOWN"
  | "STALE"
  | "ABSENT";

export function evidenceState(
  item: Pick<
    ApiOpportunitySummary,
    "data_state" | "presence" | "freshness_state" | "trade_analysis_status"
  >,
): WebEvidenceState {
  if (item.data_state === "ABSENT" || item.presence === "ABSENT") return "ABSENT";
  if (item.data_state === "ERROR") return "ERROR";
  if (item.data_state === "UNKNOWN" || item.freshness_state === "UNKNOWN") return "UNKNOWN";
  if (item.data_state === "STALE" || item.freshness_state === "STALE") return "STALE";
  if (item.data_state === "PARTIAL" || item.trade_analysis_status === "PARTIAL") return "PARTIAL";
  return "COMPLETE";
}

export function scoreLabel(score: ApiOpportunitySummary["score"]): string {
  return score.value === null ? "Unavailable" : score.value.toFixed(2);
}

export function adviceLabel(advice: ApiOpportunitySummary["advice"]): string {
  return advice.kind.replaceAll("_", " ");
}

export function shouldEmphasizeLimitations(item: ApiOpportunitySummary): boolean {
  return (
    item.data_state !== "COMPLETE" ||
    item.limitations.length > 0 ||
    item.blockers.length > 0
  );
}
