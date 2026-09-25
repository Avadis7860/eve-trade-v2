const apiBase =
  window.EVE_TRADE_API_BASE ||
  (window.location.port === "3000" ? window.location.origin : "http://localhost:3000");

const listElement = document.getElementById("list");
const stateElement = document.getElementById("state");
const detailElement = document.getElementById("detail");
const refreshButton = document.getElementById("refresh");
const freshnessSelect = document.getElementById("freshness");

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
  const article = document.createElement("article");
  article.className = "card";
  article.tabIndex = 0;

  const warning =
    item.data_state !== "COMPLETE" ||
    item.limitations.length > 0 ||
    item.blockers.length > 0;

  article.innerHTML = `
    <div class="row">
      <strong>Type ${item.type_id}</strong>
      <span class="badge">${stateLabel(item)}</span>
    </div>
    <div class="row" style="margin-top:12px">
      <div>
        <div class="muted">Score</div>
        <div class="score">${scoreLabel(item.score)}</div>
      </div>
      <div style="text-align:right">
        <div class="muted">Advice</div>
        <strong>${item.advice.kind.replaceAll("_", " ")}</strong>
      </div>
    </div>
    <p class="muted">Quantity: ${item.requested_quantity}</p>
    <p class="muted">Observed: ${new Date(item.observed_at).toLocaleString()}</p>
    ${warning ? "<div class='warning'>Evidence needs attention. Review blockers and limitations in the detail view.</div>" : ""}
  `;

  const open = () => void loadDetail(item.opportunity_id);
  article.addEventListener("click", open);
  article.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") open();
  });
  return article;
}

function renderList(payload) {
  listElement.replaceChildren();

  if (payload.data.items.length === 0) {
    showState("No opportunity is available in the requested evidence scope.");
    return;
  }

  clearState();
  for (const item of payload.data.items) {
    listElement.append(renderCard(item));
  }
}

async function loadList() {
  showState("Loading opportunities…");
  detailElement.hidden = true;

  const query = new URLSearchParams({
    principal_scope: "PUBLIC",
    limit: "100",
  });
  const freshness = freshnessSelect.value;
  if (freshness === "CURRENT" || freshness === "STALE" || freshness === "UNKNOWN") {
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
  detailElement.textContent = "Loading opportunity detail…";

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
    const warning =
      item.data_state !== "COMPLETE" ||
      item.limitations.length > 0 ||
      item.blockers.length > 0;

    detailElement.innerHTML = `
      <div class="row">
        <div>
          <div class="muted">Opportunity</div>
          <h2>${item.opportunity_id}</h2>
        </div>
        <div>
          <div class="muted">Score</div>
          <div class="score">${scoreLabel(item.score)}</div>
        </div>
      </div>
      <p><strong>Advice:</strong> ${item.advice.kind.replaceAll("_", " ")}</p>
      <p><strong>Evidence state:</strong> ${stateLabel(item)}</p>
      <p><strong>Simulated return:</strong> ${item.economic_result.simulated_return === null ? "Unavailable" : (Number(item.economic_result.simulated_return) * 100).toFixed(2) + "%"}</p>
      <p><strong>Prediction signal:</strong> ${scoring.prediction.status}</p>
      <h3>Why</h3>
      <ul>
        ${scoring.reasons.length ? scoring.reasons.map((reason) => `<li>${reason.code}: ${reason.message}</li>`).join("") : "<li>No additional blockers or reasons.</li>"}
      </ul>
      <h3>Evidence</h3>
      <p class="muted">${scoring.evidence.length} evidence references are attached to the score.</p>
      <h3>Limitations</h3>
      <ul>
        ${item.limitations.length ? item.limitations.map((text) => `<li>${text}</li>`).join("") : "<li>None recorded.</li>"}
      </ul>
      ${warning ? "<div class='warning'>This opportunity is not backed by a fully current evidence state. The limitation remains visible.</div>" : ""}
      <details>
        <summary>Contract evidence</summary>
        <pre>${escapeHtml(JSON.stringify({ scope: item.scope, provenance: item.provenance, scoring }, null, 2))}</pre>
      </details>
    `;
    detailElement.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    detailElement.textContent =
      `Detail unavailable: ${error instanceof Error ? error.message : "unknown error"}`;
  }
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

refreshButton.addEventListener("click", () => void loadList());
freshnessSelect.addEventListener("change", () => void loadList());
void loadList();
