import type {
  CharacterSourceProvenance,
  EsiWalletTransaction,
  ObservedEconomicTransactionEvidence,
} from "@eve-trade/contracts";

export interface CreateObservedEconomicTransactionEvidenceInput {
  character_id: number;
  observation_id: string;
  observed_at: string;
  provenance: CharacterSourceProvenance;
  transaction: EsiWalletTransaction;
}

export function createObservedEconomicTransactionEvidence(
  input: CreateObservedEconomicTransactionEvidenceInput,
): ObservedEconomicTransactionEvidence {
  if (input.provenance.principal_id !== input.character_id) {
    throw new Error(
      `Observed transaction evidence character ${input.character_id} does not match provenance principal ${input.provenance.principal_id}`,
    );
  }

  return {
    evidence_id: `esi:character:${input.character_id}:transaction:${input.transaction.transaction_id}`,
    character_id: input.character_id,
    observation_id: input.observation_id,
    observed_at: input.observed_at,
    provenance: input.provenance,
    transaction: input.transaction,
  };
}

const comparableTransactionFields = [
  "client_id",
  "date",
  "is_buy",
  "is_personal",
  "journal_ref_id",
  "location_id",
  "quantity",
  "transaction_id",
  "type_id",
  "unit_price",
] as const;

export function assertConsistentObservedEconomicTransactionEvidence(
  left: ObservedEconomicTransactionEvidence,
  right: ObservedEconomicTransactionEvidence,
): void {
  if (left.character_id !== right.character_id) {
    throw new Error("Observed transaction evidence belongs to different characters");
  }

  if (left.transaction.transaction_id !== right.transaction.transaction_id) {
    throw new Error("Observed transaction evidence has different transaction ids");
  }

  for (const field of comparableTransactionFields) {
    if (left.transaction[field] !== right.transaction[field]) {
      throw new Error(
        `Conflicting ESI transaction payload for character ${left.character_id} transaction ${left.transaction.transaction_id}: ${field}`,
      );
    }
  }

  if (left.provenance.principal_id !== right.provenance.principal_id) {
    throw new Error("Observed transaction evidence has different provenance principals");
  }
}
