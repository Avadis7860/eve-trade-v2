export function pipelineStateMessage(pipeline) {
  if (!pipeline) {
    return "No opportunity pipeline run is available yet; the opportunity surface has not been populated.";
  }

  switch (pipeline.status) {
    case "NO_CANDIDATES":
      return "The latest complete market evidence produced no eligible opportunity candidates.";
    case "INPUT_UNAVAILABLE":
      return "The latest opportunity pipeline could not evaluate the market because required evidence is unavailable or incomplete.";
    case "ERROR":
      return "The latest opportunity pipeline run failed. Existing observations may be stale; no new valid result was produced.";
    case "SUCCESS":
      return null;
    default:
      return "The opportunity pipeline state is unknown.";
  }
}
