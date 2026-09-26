import type { CharacterSourceProvenance } from "./market.js";
import type { EsiWalletTransaction } from "./player.js";

export interface ObservedEconomicTransactionEvidence {
  evidence_id: string;
  character_id: number;
  observation_id: string;
  observed_at: string;
  provenance: CharacterSourceProvenance;
  transaction: EsiWalletTransaction;
}

export function observedEconomicTransactionEvidenceKey(
  evidence: ObservedEconomicTransactionEvidence,
): string {
  return `${evidence.character_id}:${evidence.transaction.transaction_id}`;
}
