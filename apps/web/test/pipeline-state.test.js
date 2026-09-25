import assert from "node:assert/strict";
import test from "node:test";
import { pipelineStateMessage } from "../public/pipeline-state.js";

test("web distinguishes missing pipeline execution from a true empty result", () => {
  assert.match(pipelineStateMessage(null), /has not been populated/);
  assert.match(
    pipelineStateMessage({ status: "NO_CANDIDATES" }),
    /no eligible opportunity candidates/,
  );
});

test("web surfaces unavailable input and pipeline errors distinctly", () => {
  assert.match(
    pipelineStateMessage({ status: "INPUT_UNAVAILABLE" }),
    /required evidence is unavailable/,
  );
  assert.match(
    pipelineStateMessage({ status: "ERROR" }),
    /pipeline run failed/,
  );
});

test("successful pipeline leaves the opportunity card state unobstructed", () => {
  assert.equal(pipelineStateMessage({ status: "SUCCESS" }), null);
});
