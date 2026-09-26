import assert from "node:assert/strict";
import test from "node:test";
import type { CharacterSourceProvenance, EsiWalletTransaction } from "@eve-trade/contracts";
import {
  assertConsistentObservedEconomicTransactionEvidence,
  createObservedEconomicTransactionEvidence,
} from "../src/economic-evidence.js";

const provenance: CharacterSourceProvenance = {
  source_kind: "ESI",
  source_id: "esi-wallet-transactions-123",
  endpoint: "/characters/{character_id}/wallet/transactions/",
  principal_scope: "CHARACTER",
  principal_id: 123,
};

const transaction: EsiWalletTransaction = {
  client_id: 456,
  date: "2026-09-26T05:00:00Z",
  is_buy: true,
  is_personal: true,
  journal_ref_id: 789,
  location_id: 60003760,
  quantity: 10,
  transaction_id: 987654321,
  type_id: 34,
  unit_price: 100,
};

test("normalizes one ESI transaction as FACT without operation attribution", () => {
  const evidence = createObservedEconomicTransactionEvidence({
    character_id: 123,
    observation_id: "obs-1",
    observed_at: "2026-09-26T05:01:00Z",
    provenance,
    transaction,
  });

  assert.equal(
    evidence.evidence_id,
    "esi:character:123:transaction:987654321",
  );
  assert.equal(evidence.character_id, 123);
  assert.equal(evidence.observation_id, "obs-1");
  assert.deepEqual(evidence.provenance, provenance);
  assert.deepEqual(evidence.transaction, transaction);
  assert.equal("operation_id" in evidence, false);
});

test("rejects an inconsistent character principal", () => {
  assert.throws(
    () =>
      createObservedEconomicTransactionEvidence({
        character_id: 124,
        observation_id: "obs-inconsistent",
        observed_at: "2026-09-26T05:01:00Z",
        provenance,
        transaction,
      }),
    /does not match provenance principal/,
  );
});

test("the evidence identity is stable for repeated observations of the same transaction", () => {
  const first = createObservedEconomicTransactionEvidence({
    character_id: 123,
    observation_id: "obs-1",
    observed_at: "2026-09-26T05:01:00Z",
    provenance,
    transaction,
  });
  const repeat = createObservedEconomicTransactionEvidence({
    character_id: 123,
    observation_id: "obs-2",
    observed_at: "2026-09-26T05:10:00Z",
    provenance: {
      ...provenance,
      source_id: "esi-wallet-transactions-124",
    },
    transaction,
  });

  assert.equal(first.evidence_id, repeat.evidence_id);
  assert.doesNotThrow(() =>
    assertConsistentObservedEconomicTransactionEvidence(first, repeat),
  );
});

test("conflicting payloads for the same character and transaction id are rejected", () => {
  const first = createObservedEconomicTransactionEvidence({
    character_id: 123,
    observation_id: "obs-1",
    observed_at: "2026-09-26T05:01:00Z",
    provenance,
    transaction,
  });
  const conflicting = createObservedEconomicTransactionEvidence({
    character_id: 123,
    observation_id: "obs-3",
    observed_at: "2026-09-26T05:11:00Z",
    provenance,
    transaction: {
      ...transaction,
      quantity: 11,
    },
  });

  assert.throws(
    () =>
      assertConsistentObservedEconomicTransactionEvidence(
        first,
        conflicting,
      ),
    /Conflicting ESI transaction payload/,
  );
});

test("the same transaction id under another character remains a distinct evidence identity", () => {
  const otherCharacter = createObservedEconomicTransactionEvidence({
    character_id: 124,
    observation_id: "obs-other",
    observed_at: "2026-09-26T05:12:00Z",
    provenance: {
      ...provenance,
      source_id: "esi-wallet-transactions-200",
      principal_id: 124,
    },
    transaction,
  });

  assert.equal(
    otherCharacter.evidence_id,
    "esi:character:124:transaction:987654321",
  );
  assert.notEqual(
    otherCharacter.evidence_id,
    "esi:character:123:transaction:987654321",
  );
  assert.throws(
    () =>
      assertConsistentObservedEconomicTransactionEvidence(
        createObservedEconomicTransactionEvidence({
          character_id: 123,
          observation_id: "obs-1",
          observed_at: "2026-09-26T05:01:00Z",
          provenance,
          transaction,
        }),
        otherCharacter,
      ),
    /different characters/,
  );
});
