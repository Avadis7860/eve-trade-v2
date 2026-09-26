import { pipelineStateMessage } from "./pipeline-state.js";

const apiBase =
  window.EVE_TRADE_API_BASE ||
  (window.location.port === "3000"
    ? window.location.origin
    : "http://localhost:3000");

const listElement = document.getElementById("list");
const stateElement = document.getElementById("state");
const detailElement = document.getElementById("detail");
const refreshButton = document.getElementById("refresh");
const freshnessSelect = document.getElementById("freshness");
const viewOpportunitiesButton = document.getElementById("viewOpportunities");
const viewOperationsButton = document.getElementById("viewOperations");
const pageTitle = document.getElementById("pageTitle");
let currentView = "opportunities";

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function showState(message) {
  stateElement.hidden = false;
  stateElement.textContent = message;
}

function clearState() {
  stateElement.hidden = true;
  stateElement.textContent = "";
}

function scoreLabel(score) {
  return score.value === null ? "Unavailable" : Number(score.value).toFixed(2);
}

function stateLabel(item) {
  return item.data_state.replaceAll("_", " ");
}

function renderCard(item) {
  const article = node("article");
  article.className = "card";
  article.tabIndex = 0;

  const header = node("div", undefined, "row");
  header.append(
    node("strong", `Type ${item.type_id}`),
    node("span", stateLabel(item), "badge"),
  );

  const metrics = node("div", undefined, "row");
  metrics.style.marginTop = "12px";

  const scoreBlock = node("div");
  scoreBlock.append(node("div", "Score", "muted"), node("div", scoreLabel(item.score), "score"));

  const adviceBlock = node("div");
  adviceBlock.style.textAlign = "right";
  adviceBlock.append(
    node("div", "Advice", "muted"),
    node("strong", item.advice.kind.replaceAll("_", " ")),
  );

  metrics.append(scoreBlock, adviceBlock);

  article.append(
    header,
    metrics,
    node("p", `Quantity: ${item.requested_quantity}`, "muted"),
    node("p", `Observed: ${new Date(item.observed_at).toLocaleString()}`, "muted"),
  );

  const warning =
    item.data_state !== "COMPLETE" ||
    item.limitations.length > 0 ||
    item.blockers.length > 0;

  if (warning) {
    article.append(
      node(
        "div",
        "Evidence needs attention. Review blockers and limitations in the detail view.",
        "warning",
      ),
    );
  }

  const open = () => void loadDetail(item.opportunity_id);
  article.addEventListener("click", open);
  article.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") open();
  });
  return article;
}

function renderList(payload) {
  listElement.replaceChildren();

  const pipelineMessage = pipelineStateMessage(payload.data.pipeline);

  if (payload.data.items.length === 0) {
    showState(
      pipelineMessage ??
        "No opportunity is available in the requested evidence scope.",
    );
    return;
  }

  if (pipelineMessage) showState(pipelineMessage);
  else clearState();

  for (const item of payload.data.items) {
    listElement.append(renderCard(item));
  }
}

function appendReasonList(parent, title, values, fallback) {
  parent.append(node("h3", title));
  const list = node("ul");
  if (values.length === 0) {
    list.append(node("li", fallback));
  } else {
    for (const value of values) {
      const text =
        typeof value === "string"
          ? value
          : `${value.code}: ${value.message}`;
      list.append(node("li", text));
    }
  }
  parent.append(list);
}

function formatNumber(value) {
  return value === null || value === undefined
    ? "Unavailable"
    : Number(value).toLocaleString();
}

function formatResult(value) {
  return value === null || value === undefined
    ? "Unavailable"
    : Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function renderOperationCard(item) {
  const article = node("article");
  article.className = "card";
  article.tabIndex = 0;

  const header = node("div", undefined, "row");
  header.append(
    node("strong", `Operation ${item.operation_id}`),
    node("span", item.lifecycle_state.replaceAll("_", " "), "badge"),
  );

  article.append(
    header,
    node("p", `Type ${item.type_id}`, "muted"),
    node(
      "p",
      `Quantity: ${formatNumber(item.acquired_quantity)} acquired / ${formatNumber(item.unacquired_quantity)} unacquired / ${formatNumber(item.disposed_quantity)} disposed / ${formatNumber(item.remaining_quantity)} remaining`,
    ),
    node(
      "p",
      `Current result: ${formatResult(item.result.observed_current_result)}`,
      "muted",
    ),
    node(
      "p",
      `Terminal result: ${formatResult(item.result.terminal_result)}`,
      "muted",
    ),
    node(
      "p",
      `Disposition: ${item.disposition_mode.replaceAll("_", " ")}`,
      "muted",
    ),
  );

  const open = () => void loadOperationDetail(item.operation_id);
  article.addEventListener("click", open);
  article.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") open();
  });
  return article;
}

function renderOperations(payload) {
  listElement.replaceChildren();
  if (payload.data.items.length === 0) {
    showState(
      "No economic operation has been explicitly persisted in the requested evidence scope.",
    );
    return;
  }
  clearState();
  for (const item of payload.data.items) {
    listElement.append(renderOperationCard(item));
  }
}

async function loadOperations() {
  showState("Loading economic operations…");
  detailElement.hidden = true;

  try {
    const response = await fetch(
      `${apiBase}/api/v1/operations?principal_scope=PUBLIC&limit=100`,
    );
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error?.message || "API request failed");
    }
    renderOperations(payload);
  } catch (error) {
    showState(
      `API unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    listElement.replaceChildren();
  }
}

async function loadOperationDetail(operationId) {
  detailElement.hidden = false;
  detailElement.replaceChildren();
  detailElement.append(node("p", "Loading economic operation detail…"));

  try {
    const response = await fetch(
      `${apiBase}/api/v1/operations/${encodeURIComponent(operationId)}?principal_scope=PUBLIC`,
    );
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error?.message || "Detail request failed");
    }

    const item = payload.data;
    const content = node("div");
    const header = node("div", undefined, "row");
    header.append(
      node("div", item.operation_id),
      node("span", item.lifecycle_state.replaceAll("_", " "), "badge"),
    );

    content.append(
      header,
      node("p", `Type: ${item.type_id}`),
      node(
        "p",
        `Acquired: ${formatNumber(item.acquired_quantity)} · Unacquired: ${formatNumber(item.unacquired_quantity)} · Disposed: ${formatNumber(item.disposed_quantity)} · Remaining: ${formatNumber(item.remaining_quantity)}`,
      ),
      node("p", `Evaluation: ${item.evaluation_state.replaceAll("_", " ")}`),
      node("p", `Observed current result: ${formatResult(item.result.observed_current_result)}`),
      node("p", `Projected current result: ${formatResult(item.result.projected_current_result)}`),
      node("p", `Terminal result: ${formatResult(item.result.terminal_result)}`),
      node("p", `Observed sub-result: ${formatResult(item.result.observed_sub_result)}`),
      node("p", `Execution disposition mode: ${item.disposition_mode.replaceAll("_", " ")}`),
    );

    const position = item.position
      ? `Position: ${formatNumber(item.position.quantity)} units · age ${formatResult(item.position.age_seconds)}s`
      : "Position: none";

    content.append(node("p", position, "muted"));

    const details = node("details");
    details.append(node("summary", "Evidence / provenance"));
    const pre = node("pre");
    pre.textContent = JSON.stringify(
      {
        scope: item.scope,
        provenance: item.provenance,
        acquisition_evidence: item.operation.acquisition_evidence,
        disposition_evidence: item.operation.disposition_evidence,
        projected_disposition: item.operation.projected_disposition,
        history: payload.data.history,
      },
      null,
      2,
    );
    details.append(pre);
    content.append(details);

    if (item.operation.projected_disposition) {
      content.append(
        node(
          "div",
          "Projected disposition is a scenario only; it does not confirm an order placement or fill.",
          "warning",
        ),
      );
    }
    detailElement.replaceChildren(content);
    detailElement.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    detailElement.replaceChildren(
      node(
        "p",
        `Detail unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
      ),
    );
  }
}

function setView(view) {
  currentView = view;
  pageTitle.textContent = view === "operations" ? "Economic Operations" : "Opportunities";
  freshnessSelect.parentElement.hidden = view === "operations";
  detailElement.hidden = true;
  if (view === "operations") void loadOperations();
  else void loadList();
}

async function loadList() {
  showState("Loading opportunities…");
  detailElement.hidden = true;

  const query = new URLSearchParams({
    principal_scope: "PUBLIC",
    limit: "100",
  });
  const freshness = freshnessSelect.value;
  if (
    freshness === "CURRENT" ||
    freshness === "STALE" ||
    freshness === "UNKNOWN"
  ) {
    query.set("freshness_state", freshness);
  }

  try {
    const response = await fetch(`${apiBase}/api/v1/opportunities?${query}`);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error?.message || "API request failed");
    }
    renderList(payload);
  } catch (error) {
    showState(
      `API unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    listElement.replaceChildren();
  }
}

async function loadDetail(opportunityId) {
  detailElement.hidden = false;
  detailElement.replaceChildren();
  detailElement.append(node("p", "Loading opportunity detail…"));

  try {
    const response = await fetch(
      `${apiBase}/api/v1/opportunities/${encodeURIComponent(opportunityId)}?principal_scope=PUBLIC`,
    );
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error?.message || "Detail request failed");
    }

    const item = payload.data;
    const scoring = item.scoring;

    const header = node("div", undefined, "row");
    const identity = node("div");
    identity.append(
      node("div", "Opportunity", "muted"),
      node("h2", item.opportunity_id),
    );

    const scoreBlock = node("div");
    scoreBlock.append(
      node("div", "Score", "muted"),
      node("div", scoreLabel(item.score), "score"),
    );

    header.append(identity, scoreBlock);

    const content = node("div");
    content.append(
      header,
      node("p", `Advice: ${item.advice.kind.replaceAll("_", " ")}`),
      node("p", `Evidence state: ${stateLabel(item)}`),
      node(
        "p",
        `Simulated return: ${item.economic_result.simulated_return === null
          ? "Unavailable"
          : `${(Number(item.economic_result.simulated_return) * 100).toFixed(2)}%`}`,
      ),
      node("p", `Prediction signal: ${scoring.prediction.status}`),
    );

    appendReasonList(
      content,
      "Why",
      scoring.reasons,
      "No additional blockers or reasons.",
    );

    content.append(
      node(
        "p",
        `${scoring.evidence.length} evidence references are attached to the score.`,
        "muted",
      ),
    );

    appendReasonList(
      content,
      "Limitations",
      item.limitations,
      "None recorded.",
    );

    const warning =
      item.data_state !== "COMPLETE" ||
      item.limitations.length > 0 ||
      item.blockers.length > 0;

    if (warning) {
      content.append(
        node(
          "div",
          "This opportunity is not backed by a fully current evidence state. The limitation remains visible.",
          "warning",
        ),
      );
    }

    const details = node("details");
    details.append(node("summary", "Contract evidence"));
    const pre = node("pre");
    pre.textContent = JSON.stringify(
      { scope: item.scope, provenance: item.provenance, scoring },
      null,
      2,
    );
    details.append(pre);
    content.append(details);

    detailElement.replaceChildren(content);
    detailElement.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    detailElement.replaceChildren(
      node(
        "p",
        `Detail unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
      ),
    );
  }
}

refreshButton.addEventListener("click", () =>
  currentView === "operations" ? void loadOperations() : void loadList(),
);
freshnessSelect.addEventListener("change", () => void loadList());
viewOpportunitiesButton.addEventListener("click", () => setView("opportunities"));
viewOperationsButton.addEventListener("click", () => setView("operations"));
void loadList();
