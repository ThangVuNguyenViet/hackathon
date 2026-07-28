const recommendationTypes = [
  ["localFavorites", "Local Favorites"],
  ["forYou", "For You"],
  ["modifierUpsell", "Modifier Upsell"],
  ["smartCrossSell", "Smart Cross-sell"],
];

const variants = [
  ["A", "Three-panel workbench"],
  ["B", "Engine-first studio"],
  ["C", "State-first console"],
];

const state = {
  profileKey: "authenticated",
  variant: (
    new URLSearchParams(window.location.search).get("variant") || "A"
  ).toUpperCase(),
  recommendationType:
    new URLSearchParams(window.location.search).get("recommendation") ||
    "smartCrossSell",
  engineView: "decision",
  profile: null,
  catalog: [],
  modifiers: [],
  training: null,
  loading: false,
  parentCartLineId: null,
};

if (!variants.some(([key]) => key === state.variant)) state.variant = "A";
if (
  !recommendationTypes.some(([key]) => key === state.recommendationType)
) {
  state.recommendationType = "smartCrossSell";
}

const root = document.querySelector("#prototype-root");
const toast = document.querySelector("#toast");

function money(value) {
  return `${new Intl.NumberFormat("vi-VN").format(value || 0)}₫`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function prettyKey(value) {
  return String(value)
    .replaceAll("_", " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase());
}

function updateUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("variant", state.variant);
  url.searchParams.set("recommendation", state.recommendationType);
  window.history.replaceState({}, "", url);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(
    () => toast.classList.remove("visible"),
    1800,
  );
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}

async function loadProfile() {
  state.profile = await request(`/api/state?profileKey=${state.profileKey}`);
  if (
    state.parentCartLineId &&
    !state.profile.cart.lines.some(
      (line) => line.lineId === state.parentCartLineId,
    )
  ) {
    state.parentCartLineId = null;
  }
}

async function initialize() {
  const [catalogResult, training] = await Promise.all([
    request("/api/catalog"),
    request("/api/training"),
  ]);
  state.catalog = catalogResult.catalog;
  state.modifiers = catalogResult.modifiers;
  state.training = training;
  await loadProfile();
  render();
}

async function perform(action, successMessage) {
  if (state.loading) return;
  state.loading = true;
  render();
  try {
    await action();
    if (successMessage) showToast(successMessage);
  } catch (error) {
    showToast(`Could not complete action: ${error.message}`);
  } finally {
    state.loading = false;
    render();
  }
}

async function addItem(itemId) {
  await perform(async () => {
    state.profile = await request("/api/cart/add", {
      method: "POST",
      body: JSON.stringify({ profileKey: state.profileKey, itemId }),
    });
  }, "Cart persisted to local D1");
}

async function removeLine(lineId) {
  await perform(async () => {
    state.profile = await request("/api/cart/remove", {
      method: "POST",
      body: JSON.stringify({ profileKey: state.profileKey, lineId }),
    });
  }, "Cart line removed from D1");
}

async function checkout() {
  await perform(async () => {
    const result = await request("/api/checkout", {
      method: "POST",
      body: JSON.stringify({ profileKey: state.profileKey }),
    });
    state.profile = result.state;
    state.parentCartLineId = null;
  }, state.profile.identity.linked
    ? "Checkout became reusable authenticated history"
    : "Guest checkout recorded but not linked to personalization");
}

async function resetProfile() {
  await perform(async () => {
    state.profile = await request("/api/reset", {
      method: "POST",
      body: JSON.stringify({ profileKey: state.profileKey }),
    });
    state.parentCartLineId = null;
  }, "Current demo profile reset");
}

async function runRecommendation() {
  await perform(async () => {
    const result = await request(
      `/api/recommendations/${state.recommendationType}`,
      {
        method: "POST",
        body: JSON.stringify({
          profileKey: state.profileKey,
          parentCartLineId: state.parentCartLineId,
        }),
      },
    );
    state.profile = result.state;
    state.engineView = "decision";
  }, "Independent recommendation request completed");
}

function setProfile(profileKey) {
  if (profileKey === state.profileKey || state.loading) return;
  perform(async () => {
    state.profileKey = profileKey;
    state.parentCartLineId = null;
    await loadProfile();
  });
}

function setRecommendation(type) {
  state.recommendationType = type;
  state.engineView = "decision";
  updateUrl();
  render();
}

function setVariant(variant) {
  state.variant = variant;
  updateUrl();
  render();
}

function moveVariant(direction) {
  const index = variants.findIndex(([key]) => key === state.variant);
  setVariant(variants[(index + direction + variants.length) % variants.length][0]);
}

function identityToggle() {
  return `
    <button
      type="button"
      class="${state.profileKey === "guest" ? "active" : ""}"
      data-profile="guest"
    >Guest</button>
    <button
      type="button"
      class="${state.profileKey === "authenticated" ? "active" : ""}"
      data-profile="authenticated"
    >Authenticated</button>
  `;
}

function commercePanel() {
  const profile = state.profile;
  return `
    <section class="panel commerce-panel">
      <header class="panel-header">
        <div>
          <span class="panel-kicker">Commerce simulator</span>
          <h2>Menu and cart</h2>
          <p>These mutations write to scratch local D1.</p>
        </div>
        <span class="revision-chip">cart revision ${profile.cart.revision}</span>
      </header>
      <div class="commerce-body">
        <section class="menu-section">
          <div class="menu-grid">
            ${state.catalog
              .map(
                (item) => `
                  <article class="menu-card">
                    <div class="menu-emoji">${item.emoji}</div>
                    <strong>${escapeHtml(item.name)}</strong>
                    <footer>
                      <span class="price">${money(item.priceVnd)}</span>
                      <button
                        type="button"
                        class="icon-button"
                        data-add-item="${item.id}"
                        aria-label="Add ${escapeHtml(item.name)}"
                        ${state.loading ? "disabled" : ""}
                      >+</button>
                    </footer>
                  </article>
                `,
              )
              .join("")}
          </div>
        </section>
        <section class="cart-section">
          <div class="section-heading">
            <div>
              <h3>Current cart</h3>
              <p>Choose any cart line separately for Modifier Upsell.</p>
            </div>
          </div>
          ${
            profile.cart.lines.length
              ? `
                <div class="cart-lines">
                  ${profile.cart.lines
                    .map(
                      (line) => `
                        <div class="cart-line">
                          <span>${line.emoji}</span>
                          <div>
                            <strong>${escapeHtml(line.name)}</strong>
                            <small>${line.quantity} × ${money(line.priceVnd)} · ${escapeHtml(line.lineId)}</small>
                          </div>
                          <span class="price">${money(line.quantity * line.priceVnd)}</span>
                          <button
                            type="button"
                            class="remove-line"
                            data-remove-line="${line.lineId}"
                            aria-label="Remove ${escapeHtml(line.name)}"
                          >×</button>
                        </div>
                      `,
                    )
                    .join("")}
                </div>
              `
              : `<div class="empty-inline">Add an item from the menu. Reloading the page will keep it.</div>`
          }
          <div class="cart-summary">
            <div>
              <small class="state-muted">${profile.cart.lines.length} cart lines</small>
              <strong>${money(profile.cart.subtotalVnd)}</strong>
            </div>
            <button
              type="button"
              class="button"
              id="checkout"
              ${profile.cart.lines.length === 0 || state.loading ? "disabled" : ""}
            >Checkout</button>
          </div>
        </section>
      </div>
    </section>
  `;
}

function recommendationControls() {
  const modifierOptions = state.profile.cart.lines;
  return `
    <div class="engine-controls">
      <div class="rec-tabs">
        ${recommendationTypes
          .map(
            ([type, label]) => `
              <button
                type="button"
                class="rec-tab ${state.recommendationType === type ? "active" : ""}"
                data-recommendation-type="${type}"
              >${label}</button>
            `,
          )
          .join("")}
      </div>
      <div class="view-tabs">
        <button
          type="button"
          class="view-tab ${state.engineView === "decision" ? "active" : ""}"
          data-engine-view="decision"
        >Current decision</button>
        <button
          type="button"
          class="view-tab ${state.engineView === "training" ? "active" : ""}"
          data-engine-view="training"
        >How the models were trained</button>
      </div>
      <div class="request-actions">
        ${
          state.recommendationType === "modifierUpsell"
            ? `
              <select class="parent-select" id="parent-cart-line">
                <option value="">Select a parent cart line</option>
                ${modifierOptions
                  .map(
                    (line) => `
                      <option
                        value="${line.lineId}"
                        ${state.parentCartLineId === line.lineId ? "selected" : ""}
                      >${escapeHtml(line.name)} · ${escapeHtml(line.lineId)}</option>
                    `,
                  )
                  .join("")}
              </select>
            `
            : `<div class="state-muted">Runs independently using the current durable snapshot.</div>`
        }
        <button
          type="button"
          class="button dark"
          id="run-recommendation"
          ${state.loading ? "disabled" : ""}
        >Run recommendation</button>
      </div>
    </div>
  `;
}

function enginePanel() {
  return `
    <section class="panel engine-panel">
      <header class="panel-header">
        <div>
          <span class="panel-kicker">Recommendation engine</span>
          <h2>Inputs → engine → output</h2>
          <p>Each tab is an independent request, not an ordering stage.</p>
        </div>
      </header>
      ${recommendationControls()}
      <div class="engine-content">
        ${
          state.engineView === "training"
            ? trainingView()
            : decisionView(state.profile.lastDecision)
        }
      </div>
    </section>
  `;
}

function decisionView(decision) {
  if (!decision || decision.type !== state.recommendationType) {
    const label = recommendationTypes.find(
      ([type]) => type === state.recommendationType,
    )[1];
    return `
      <div class="empty-state">
        <div>
          <div class="empty-state-icon">⚙️</div>
          <h3>Run ${label}</h3>
          <p>The engine will snapshot the current D1 state, explain each processing stage, and return recommendations or a typed empty result.</p>
        </div>
      </div>
    `;
  }
  if (decision.status === "empty") return emptyDecision(decision);
  const recommendations = decision.recommendations || [];
  const winner = recommendations[0];
  return `
    <div class="decision-heading">
      <div>
        <span class="step-label">Independent request result</span>
        <h3>${prettyKey(decision.type)}</h3>
        <div class="decision-meta">${escapeHtml(decision.requestId)} · cart revision ${decision.cartRevision}</div>
      </div>
      <span class="status-chip success">completed</span>
    </div>
    <section class="recommendation-output">
      <article class="winner-card">
        <span class="output-label">Top recommended output</span>
        <div class="winner-emoji">${winner.emoji}</div>
        <h4>${escapeHtml(winner.name)}</h4>
        <span class="price">${money(winner.priceVnd)}</span>
        <p>Highest-ranked eligible action under the current serving authority.</p>
      </article>
      <div>
        <div class="section-heading">
          <div>
            <h3>Returned slate</h3>
            <p>${recommendations.length} actions, ordered by score.</p>
          </div>
        </div>
        <div class="alternative-list">
          ${recommendations
            .map(
              (item, index) => `
                <div class="alternative">
                  <span>${item.emoji}</span>
                  <div>
                    <strong>${index + 1}. ${escapeHtml(item.name)}</strong>
                    <small>${money(item.priceVnd)} · ${escapeHtml(item.actionId)}</small>
                  </div>
                  <span class="score">${Number(item.score).toFixed(3)}</span>
                </div>
              `,
            )
            .join("")}
        </div>
      </div>
    </section>
    <section class="trace-grid">
      <article class="trace-card">
        <span class="step-label">Engine execution</span>
        <h4>What the engine did</h4>
        <div class="stage-list">
          ${decision.stages
            .map(
              (stage, index) => `
                <div class="stage">
                  <span class="stage-number">${index + 1}</span>
                  <div>
                    <strong>${prettyKey(stage.name)}</strong>
                    <small>${escapeHtml(stageSummary(stage))}</small>
                  </div>
                </div>
              `,
            )
            .join("")}
        </div>
      </article>
      <article class="trace-card">
        <span class="step-label">Candidate evidence</span>
        <h4>Inputs, eligibility, features and scores</h4>
        <table class="candidate-table">
          <thead>
            <tr>
              <th>Candidate</th>
              <th>Eligibility</th>
              <th>Features affecting score</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            ${decision.candidates
              .map(
                (candidate, index) => `
                  <tr class="${index === 0 && candidate.eligible ? "top" : ""}">
                    <td><span class="candidate-name">${candidate.emoji} ${escapeHtml(candidate.name)}</span></td>
                    <td>${candidate.eligible ? "✓ eligible" : `✕ ${escapeHtml(candidate.rejectionReasons.join(", "))}`}</td>
                    <td>
                      <div class="feature-tags">
                        ${Object.entries(candidate.features || {})
                          .map(
                            ([name, value]) =>
                              `<span>${escapeHtml(prettyKey(name))}: ${escapeHtml(value)}</span>`,
                          )
                          .join("")}
                      </div>
                    </td>
                    <td><strong>${Number(candidate.score).toFixed(3)}</strong></td>
                  </tr>
                `,
              )
              .join("")}
          </tbody>
        </table>
      </article>
    </section>
  `;
}

function stageSummary(stage) {
  if (stage.name === "request_snapshot") return "Captured exact durable state and context.";
  if (stage.name === "candidate_enumeration") {
    return `${stage.data.count} possible actions enumerated.`;
  }
  if (stage.name === "deterministic_eligibility") {
    return `${stage.data.eligibleCount} eligible, ${stage.data.rejectedCount} rejected before ranking.`;
  }
  if (stage.name === "feature_building") {
    return `${stage.data.featureNames.length} model-visible feature fields built.`;
  }
  if (stage.name === "ranking") {
    return `${prettyKey(stage.data.authority)} ranked eligible actions; learned model promoted: ${stage.data.learnedModelPromoted}.`;
  }
  if (stage.name === "selection") {
    return `${stage.data.selectedActionIds.length} actions selected for the response.`;
  }
  return JSON.stringify(stage.data);
}

function emptyDecision(decision) {
  const reason =
    decision.emptyReason ||
    decision.stages.find((stage) => stage.status === "empty")?.data?.reason ||
    "no_eligible_recommendation";
  return `
    <div class="decision-heading">
      <div>
        <span class="step-label">Independent request result</span>
        <h3>${prettyKey(decision.type)}</h3>
      </div>
      <span class="status-chip empty">empty result</span>
    </div>
    <div class="empty-decision">
      <div>
        <div class="empty-state-icon">∅</div>
        <h3>No recommendation returned</h3>
        <p>This is a valid engine outcome. It does not silently substitute another recommendation type.</p>
        <div class="empty-reason">${escapeHtml(reason)}</div>
      </div>
    </div>
  `;
}

function trainingView() {
  const evidence = state.training;
  return `
    <section class="training-overview">
      <span class="training-label">Training evidence</span>
      <h3>How fixture behavior became model artifacts</h3>
      <p>${escapeHtml(evidence.syntheticDisclaimer)} The simulator generated ${evidence.dataset.journeys.toLocaleString()} journeys over ${evidence.dataset.seeds} seeds, then compared learned models with declared baselines on untouched test data.</p>
    </section>
    <div class="training-flow">
      ${[
        ["Synthetic world", "Catalog, stores, customers and hidden preferences."],
        ["Logged journeys", "Opportunities, impressions, selections and checkout."],
        ["Data split", "Train, validation and untouched test."],
        ["Model training", "Competing rankers fit the same candidate rows."],
        ["Qualification", "Value, relevance, safety and coverage gates."],
        ["Versioned result", "Promote or retain baseline with immutable digest."],
      ]
        .map(
          ([title, detail]) => `
            <div class="training-step"><b>${title}</b><span>${detail}</span></div>
          `,
        )
        .join("")}
    </div>
    <div class="training-matrix">
      ${recommendationTypes
        .map(([type, label]) => trainingCard(type, label, evidence.placements[type]))
        .join("")}
    </div>
  `;
}

function trainingCard(type, label, placement) {
  return `
    <article class="training-card">
      <div class="status-row">
        <div>
          <span class="training-label">${label}</span>
          <h4>${placement.model || "No learned artifact"}</h4>
        </div>
        <span class="training-status ${placement.trained ? "trained" : "missing"}">
          ${placement.trained ? "trained" : "not trained"}
        </span>
      </div>
      <p>${escapeHtml(placement.result)}</p>
      <p><strong>Serving:</strong> ${escapeHtml(prettyKey(placement.servingAuthority))} · <strong>Promotion:</strong> ${escapeHtml(prettyKey(placement.promotion))}</p>
      ${placement.digest ? `<code>${placement.digest}</code>` : ""}
    </article>
  `;
}

function statePanel() {
  const profile = state.profile;
  return `
    <aside class="panel state-panel">
      <header class="panel-header">
        <div>
          <span class="panel-kicker">Durable evidence</span>
          <h2>D1 state inspector</h2>
          <p>Reload-safe scratch state for the selected profile.</p>
        </div>
      </header>
      <div class="state-content">
        <div class="state-stack">
          <section class="state-card">
            <span class="state-label">Identity</span>
            <h3>${profile.identity.linked ? "Authenticated customer" : "Guest session"}</h3>
            ${stateRows({
              profileKey: profile.profileKey,
              sessionId: profile.identity.sessionId,
              customerRef: profile.identity.customerRef || "none",
              linked: profile.identity.linked,
              personalizationEligible:
                profile.identity.personalizationEligible,
            })}
          </section>
          <section class="state-card">
            <span class="state-label">Current cart</span>
            <h3>${profile.cart.lines.length} lines · ${money(profile.cart.subtotalVnd)}</h3>
            ${stateRows({
              revision: profile.cart.revision,
              lineIds: profile.cart.lines.map((line) => line.lineId).join(", ") || "none",
            })}
          </section>
          <section class="state-card">
            <span class="state-label">Previous orders</span>
            <h3>${profile.completedOrders.length} personalization-eligible</h3>
            ${
              profile.completedOrders.length
                ? profile.completedOrders.map(orderCard).join("")
                : `<p class="state-muted">${profile.identity.linked ? "Checkout a cart to create verified demo history." : "Guest checkouts never become linked personalization history."}</p>`
            }
          </section>
          <section class="state-card">
            <span class="state-label">Checkout outcomes</span>
            <h3>${profile.checkoutOutcomes.length} recorded</h3>
            ${
              profile.checkoutOutcomes.length
                ? profile.checkoutOutcomes.slice(0, 3).map(orderCard).join("")
                : `<p class="state-muted">No checkout recorded for this profile.</p>`
            }
          </section>
          <section class="state-card">
            <span class="state-label">Last recommendation decision</span>
            <h3>${profile.lastDecision ? prettyKey(profile.lastDecision.type) : "None"}</h3>
            ${
              profile.lastDecision
                ? stateRows({
                    requestId: profile.lastDecision.requestId,
                    status: profile.lastDecision.status,
                    cartRevision: profile.lastDecision.cartRevision,
                    recommendationId:
                      profile.lastDecision.recommendationId || "none",
                    outputActions:
                      profile.lastDecision.recommendations
                        ?.map((item) => item.actionId)
                        .join(", ") || "none",
                  })
                : `<p class="state-muted">Run any independent recommendation request.</p>`
            }
          </section>
          <details class="json-details">
            <summary>Show raw D1 projection JSON</summary>
            <pre>${escapeHtml(JSON.stringify(profile, null, 2))}</pre>
          </details>
        </div>
      </div>
    </aside>
  `;
}

function stateRows(values) {
  return Object.entries(values)
    .map(
      ([label, value]) => `
        <div class="state-row">
          <span>${escapeHtml(prettyKey(label))}</span>
          <strong>${escapeHtml(value)}</strong>
        </div>
      `,
    )
    .join("");
}

function orderCard(order) {
  return `
    <article class="order-card">
      <header>
        <strong>${escapeHtml(order.orderId)}</strong>
        <span class="price">${money(order.totalVnd)}</span>
      </header>
      <time>${escapeHtml(order.completedAt)}</time>
      <ul>
        ${order.lines
          .map(
            (line) =>
              `<li>${line.quantity} × ${escapeHtml(line.name)}</li>`,
          )
          .join("")}
      </ul>
    </article>
  `;
}

function layout() {
  const panels =
    state.variant === "A"
      ? `${commercePanel()}${enginePanel()}${statePanel()}`
      : state.variant === "B"
        ? `${commercePanel()}${statePanel()}${enginePanel()}`
        : `${statePanel()}${commercePanel()}${enginePanel()}`;
  return `<div class="workbench variant-${state.variant.toLowerCase()}">${panels}</div>`;
}

function renderVariantOptions() {
  document.querySelector("#variant-options").innerHTML = variants
    .map(
      ([key, label]) => `
        <button
          type="button"
          class="variant-option ${state.variant === key ? "active" : ""}"
          data-variant="${key}"
        >${key} · ${label}</button>
      `,
    )
    .join("");
}

function bindEvents() {
  document.querySelectorAll("[data-profile]").forEach((button) => {
    button.addEventListener("click", () => setProfile(button.dataset.profile));
  });
  document.querySelectorAll("[data-add-item]").forEach((button) => {
    button.addEventListener("click", () => addItem(button.dataset.addItem));
  });
  document.querySelectorAll("[data-remove-line]").forEach((button) => {
    button.addEventListener("click", () =>
      removeLine(button.dataset.removeLine),
    );
  });
  document.querySelectorAll("[data-recommendation-type]").forEach((button) => {
    button.addEventListener("click", () =>
      setRecommendation(button.dataset.recommendationType),
    );
  });
  document.querySelectorAll("[data-engine-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.engineView = button.dataset.engineView;
      render();
    });
  });
  document.querySelectorAll("[data-variant]").forEach((button) => {
    button.addEventListener("click", () => setVariant(button.dataset.variant));
  });
  document
    .querySelector("#checkout")
    ?.addEventListener("click", checkout);
  document
    .querySelector("#run-recommendation")
    ?.addEventListener("click", runRecommendation);
  document
    .querySelector("#parent-cart-line")
    ?.addEventListener("change", (event) => {
      state.parentCartLineId = event.target.value || null;
    });
}

function render() {
  document.querySelector("#identity-toggle").innerHTML = identityToggle();
  root.innerHTML = state.profile
    ? layout()
    : `<div class="empty-state"><div><div class="empty-state-icon">⏳</div><h3>Loading scratch D1 state…</h3></div></div>`;
  renderVariantOptions();
  bindEvents();
}

document
  .querySelector("#reset-profile")
  .addEventListener("click", resetProfile);
document
  .querySelector("#previous-variant")
  .addEventListener("click", () => moveVariant(-1));
document
  .querySelector("#next-variant")
  .addEventListener("click", () => moveVariant(1));

document.addEventListener("keydown", (event) => {
  const target = event.target;
  const editing =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target?.isContentEditable;
  if (editing) return;
  if (event.key === "ArrowLeft") moveVariant(-1);
  if (event.key === "ArrowRight") moveVariant(1);
});

initialize().catch((error) => {
  root.innerHTML = `<div class="empty-state"><div><div class="empty-state-icon">!</div><h3>Prototype failed to start</h3><p>${escapeHtml(error.message)}</p></div></div>`;
});
