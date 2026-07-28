const scenarios = {
  smartCrossSell: {
    shortLabel: "Smart Cross-sell",
    title: "Smart Cross-sell recommendation",
    description:
      "The engine independently receives the current basket and context, then returns complementary products. It does not know where this appears in a kiosk journey.",
    endpoint: "POST /v1/recommendations/smart-cross-sells",
    inputs: [
      {
        kind: "Current basket",
        value: "Combo Gà Giòn Cay",
        why: "The engine can identify missing complementary categories.",
      },
      {
        kind: "Store availability",
        value: "Khoai Tây: in stock",
        why: "Unavailable products cannot enter the eligible set.",
      },
      {
        kind: "Store behavior",
        value: "Fries commonly accompany chicken",
        why: "Historical co-purchase strength is a model feature.",
      },
      {
        kind: "Context",
        value: "District 1 · lunch",
        why: "Store and time signals alter candidate scores.",
      },
      {
        kind: "Basket economics",
        value: "Current basket 99.000₫",
        why: "Price impact is available to the ranking model.",
      },
    ],
    rules: [
      ["Available now", "Candidate is sellable at the selected store."],
      ["Not already in basket", "Avoid a duplicate product suggestion."],
      ["Valid kiosk product", "Candidate is purchasable on this channel."],
    ],
    features: [
      ["Basket complement", "+0.31"],
      ["Store co-purchase", "+0.24"],
      ["Lunch fit", "+0.15"],
      ["Price fit", "+0.12"],
    ],
    candidates: [
      ["🍟", "Khoai Tây Chiên Vừa", 35000, 0.82, "Eligible"],
      ["🍿", "Gà Popcorn", 49000, 0.72, "Eligible"],
      ["🥤", "Pepsi Lon", 25000, 0.63, "Eligible"],
      ["🍔", "Burger Zinger", 59000, 0.48, "Eligible"],
    ],
    output: {
      emoji: "🍟",
      name: "Khoai Tây Chiên Vừa",
      price: 35000,
      score: 0.82,
      reason:
        "Highest expected-value score among products that passed eligibility.",
    },
    why: [
      "Complements chicken already present in the basket.",
      "Strong historical co-purchase signal at this store.",
      "Available now and not already present in the basket.",
    ],
    contract: [
      ["Request ID", "req-cross-1042"],
      ["Candidate count", "4 eligible"],
      ["Model", "cross-sell-lgbm-poc"],
      ["Output limit", "3–4 items; top item shown"],
    ],
  },
  forYou: {
    shortLabel: "For You",
    title: "For You recommendation",
    description:
      "The engine independently uses verified completed-order history plus current store context to rank products for a known customer.",
    endpoint: "POST /v1/recommendations/for-you",
    inputs: [
      {
        kind: "Customer identity",
        value: "Verified returning customer",
        why: "For You is allowed only when history is securely linked.",
      },
      {
        kind: "Completed history",
        value: "Frequently orders spicy chicken",
        why: "Historical product affinity is a ranking feature.",
      },
      {
        kind: "Recent behavior",
        value: "Last order: Burger Zinger",
        why: "Recency and repeat preference influence the score.",
      },
      {
        kind: "Store availability",
        value: "Combo Gà Giòn Cay: in stock",
        why: "Only currently purchasable items stay eligible.",
      },
      {
        kind: "Context",
        value: "District 1 · lunch",
        why: "Time and store demand alter candidate relevance.",
      },
    ],
    rules: [
      ["Verified history", "Customer has prior completed orders."],
      ["Available now", "Candidate is sellable at the selected store."],
      ["Valid kiosk product", "Candidate is purchasable on this channel."],
    ],
    features: [
      ["Spicy affinity", "+0.34"],
      ["Repeat-category fit", "+0.23"],
      ["Store popularity", "+0.18"],
      ["Lunch fit", "+0.11"],
    ],
    candidates: [
      ["🍗", "Combo Gà Giòn Cay", 99000, 0.86, "Eligible"],
      ["🍔", "Burger Zinger", 59000, 0.81, "Eligible"],
      ["🍿", "Gà Popcorn", 49000, 0.72, "Eligible"],
    ],
    output: {
      emoji: "🍗",
      name: "Combo Gà Giòn Cay",
      price: 99000,
      score: 0.86,
      reason:
        "Best match for verified preferences among currently eligible products.",
    },
    why: [
      "Matches the customer’s verified spicy-chicken preference.",
      "Performs strongly for similar completed-order histories.",
      "Available at the selected store during lunch.",
    ],
    contract: [
      ["Request ID", "req-you-2048"],
      ["Candidate count", "3 eligible"],
      ["Model", "for-you-lgbm-poc"],
      ["History gate", "Passed"],
    ],
  },
  localFavorites: {
    shortLabel: "Local Favorites",
    title: "Local Favorites recommendation",
    description:
      "The engine independently ranks products from store-level demand and context when no verified customer history is supplied.",
    endpoint: "POST /v1/recommendations/local-favorites",
    inputs: [
      {
        kind: "Customer state",
        value: "Anonymous customer",
        why: "No personal history is used or inferred.",
      },
      {
        kind: "Store",
        value: "District 1",
        why: "Popularity is calculated for the selected location.",
      },
      {
        kind: "Store demand",
        value: "Bucket 6 Miếng is locally popular",
        why: "Recent completed sales create popularity features.",
      },
      {
        kind: "Store availability",
        value: "Bucket 6 Miếng: in stock",
        why: "Unavailable products cannot be returned.",
      },
      {
        kind: "Context",
        value: "Weekend · dinner",
        why: "Time context affects local demand relevance.",
      },
    ],
    rules: [
      ["No history required", "Safe cold-start recommendation."],
      ["Available now", "Candidate is sellable at the selected store."],
      ["Valid kiosk product", "Candidate is purchasable on this channel."],
    ],
    features: [
      ["Local popularity", "+0.38"],
      ["Weekend fit", "+0.22"],
      ["Dinner fit", "+0.17"],
      ["Recent sales", "+0.13"],
    ],
    candidates: [
      ["🪣", "Bucket 6 Miếng", 189000, 0.9, "Eligible"],
      ["🍗", "Combo Gà Giòn Cay", 99000, 0.78, "Eligible"],
      ["🍔", "Burger Zinger", 59000, 0.66, "Eligible"],
      ["🍿", "Gà Popcorn", 49000, 0.59, "Eligible"],
    ],
    output: {
      emoji: "🪣",
      name: "Bucket 6 Miếng",
      price: 189000,
      score: 0.9,
      reason:
        "Highest contextual store-popularity score among eligible products.",
    },
    why: [
      "Strong recent sales at the selected store.",
      "High weekend dinner relevance.",
      "Available now without using customer history.",
    ],
    contract: [
      ["Request ID", "req-local-3007"],
      ["Candidate count", "4 eligible"],
      ["Model", "local-favorite-lgbm-poc"],
      ["Customer history", "Not supplied"],
    ],
  },
  modifierUpsell: {
    shortLabel: "Modifier Upsell",
    title: "Modifier Upsell recommendation",
    description:
      "The engine independently receives one valid parent cart line and ranks only compatible modifiers for that product.",
    endpoint: "POST /v1/recommendations/modifier-upsells",
    inputs: [
      {
        kind: "Parent cart line",
        value: "Burger Zinger · line-7",
        why: "Modifiers must be compatible with a specific product.",
      },
      {
        kind: "Compatibility",
        value: "Cheese is allowed for Burger Zinger",
        why: "Invalid modifications are removed before ranking.",
      },
      {
        kind: "Store availability",
        value: "Cheese: in stock",
        why: "Unavailable modifiers cannot enter the eligible set.",
      },
      {
        kind: "Historical behavior",
        value: "Cheese acceptance is strong",
        why: "Past acceptance is a model feature.",
      },
      {
        kind: "Price impact",
        value: "+12.000₫",
        why: "Incremental value is included in expected-value ranking.",
      },
    ],
    rules: [
      ["Compatible modifier", "Allowed for the parent product."],
      ["Available now", "Modifier can be fulfilled at this store."],
      ["Not already selected", "Avoid duplicate modifier application."],
    ],
    features: [
      ["Parent compatibility", "+0.33"],
      ["Acceptance history", "+0.25"],
      ["Expected value", "+0.17"],
      ["Store availability", "+0.09"],
    ],
    candidates: [
      ["🧀", "Thêm Phô Mai", 12000, 0.84, "Eligible"],
      ["🥔", "Thêm Hash Brown", 19000, 0.76, "Eligible"],
      ["🌶️", "Thêm Sốt Cay", 8000, 0.67, "Eligible"],
    ],
    output: {
      emoji: "🧀",
      name: "Thêm Phô Mai",
      price: 12000,
      score: 0.84,
      reason:
        "Highest expected-value score among compatible, available modifiers.",
    },
    why: [
      "Compatible with the supplied Burger Zinger cart line.",
      "Strong acceptance history for similar baskets.",
      "Available now with a positive expected price impact.",
    ],
    contract: [
      ["Request ID", "req-mod-8812"],
      ["Candidate count", "3 eligible"],
      ["Model", "modifier-keras-poc"],
      ["Parent cart line", "line-7"],
    ],
  },
};

const variants = [
  ["A", "Decision pipeline"],
  ["B", "Influence map"],
  ["C", "Evidence scorecard"],
];

const state = {
  scenario: new URLSearchParams(window.location.search).get("scenario") ||
    "smartCrossSell",
  variant: (new URLSearchParams(window.location.search).get("variant") || "A")
    .toUpperCase(),
};

if (!scenarios[state.scenario]) state.scenario = "smartCrossSell";
if (!variants.some(([key]) => key === state.variant)) state.variant = "A";

function money(value) {
  return `${new Intl.NumberFormat("vi-VN").format(value)}₫`;
}

function updateUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("scenario", state.scenario);
  url.searchParams.set("variant", state.variant);
  window.history.replaceState({}, "", url);
}

function outputCard(scenario) {
  const output = scenario.output;
  return `
    <article class="output-card">
      <span class="output-label">Recommended output</span>
      <div class="product-visual">${output.emoji}</div>
      <h3>${output.name}</h3>
      <div class="product-price">${money(output.price)}</div>
      <p>${output.reason}</p>
      <div class="score-block">
        <div class="score-head">
          <span>Model score</span>
          <strong>${output.score.toFixed(2)}</strong>
        </div>
        <div class="score-track">
          <div class="score-fill" style="width:${output.score * 100}%"></div>
        </div>
      </div>
    </article>
  `;
}

function surfaceHeading(scenario) {
  return `
    <div class="surface-heading">
      <div>
        <h2>${scenario.title}</h2>
        <p>${scenario.description}</p>
      </div>
      <code class="endpoint">${scenario.endpoint}</code>
    </div>
  `;
}

function variantA(scenario) {
  return `
    <section class="surface">
      ${surfaceHeading(scenario)}
      <div class="pipeline">
        <section class="pipeline-column">
          <span class="step-label">1 · Affecting inputs</span>
          <h3>What the engine receives</h3>
          <p class="column-description">Only request-time, model-visible facts.</p>
          <div class="input-list">
            ${scenario.inputs
              .map(
                (input) => `
                  <div class="input-card">
                    <span class="input-kind">${input.kind}</span>
                    <strong>${input.value}</strong>
                    <p>${input.why}</p>
                  </div>
                `,
              )
              .join("")}
          </div>
        </section>
        <div class="arrow" aria-hidden="true"><span>→</span></div>
        <section class="pipeline-column">
          <span class="step-label">2 · Deterministic</span>
          <h3>Eligibility</h3>
          <p class="column-description">Unsafe or impossible options stop here.</p>
          <div class="rule-list">
            ${scenario.rules
              .map(
                ([name, detail]) => `
                  <div class="rule-card">
                    <strong>${name}</strong>
                    <p>${detail}</p>
                  </div>
                `,
              )
              .join("")}
          </div>
        </section>
        <div class="arrow" aria-hidden="true"><span>→</span></div>
        <section class="pipeline-column">
          <span class="step-label">3 · Learned</span>
          <h3>ML ranking</h3>
          <p class="column-description">The model scores only eligible candidates.</p>
          <div class="feature-list">
            ${scenario.features
              .map(
                ([name, impact]) => `
                  <div class="feature-row">
                    <span>${name}</span>
                    <span class="feature-impact">${impact}</span>
                  </div>
                `,
              )
              .join("")}
          </div>
        </section>
        <div class="arrow" aria-hidden="true"><span>→</span></div>
        ${outputCard(scenario)}
      </div>
      <div class="boundary-note">
        <div><strong>Independent call</strong>No recommendation-stage ordering is encoded here.</div>
        <div><strong>Engine responsibility</strong>Filter, score and return recommendation actions.</div>
        <div><strong>Future kiosk responsibility</strong>Choose when to call and how to render or apply an action.</div>
      </div>
    </section>
  `;
}

function variantB(scenario) {
  const midpoint = Math.ceil(scenario.inputs.length / 2);
  const renderInput = (input) => `
    <article class="map-input">
      <span class="input-kind">${input.kind}</span>
      <strong>${input.value}</strong>
      <p>${input.why}</p>
    </article>
  `;
  return `
    <section class="surface">
      ${surfaceHeading(scenario)}
      <div class="map-layout">
        <div class="input-stack left">
          ${scenario.inputs.slice(0, midpoint).map(renderInput).join("")}
        </div>
        <section class="decision-hub">
          <div class="hub-engine">
            <div>
              <strong>Eligibility</strong>
              <span>${scenario.rules.length} rules passed</span>
            </div>
            <div class="hub-arrow">→</div>
            <div>
              <strong>ML ranker</strong>
              <span>${scenario.candidates.length} candidates scored</span>
            </div>
          </div>
          ${outputCard(scenario)}
        </section>
        <div class="input-stack right">
          ${scenario.inputs.slice(midpoint).map(renderInput).join("")}
        </div>
      </div>
      <div class="map-legend">
        Every surrounding fact influences eligibility or ranking. The center is the single returned recommendation.
      </div>
    </section>
  `;
}

function variantC(scenario) {
  return `
    <section class="surface">
      ${surfaceHeading(scenario)}
      <div class="scorecard-layout">
        <section class="input-panel">
          <span class="step-label">Request evidence</span>
          <h3>Affecting inputs</h3>
          <p class="column-description">Facts supplied with this independent call.</p>
          <div class="compact-input">
            ${scenario.inputs
              .map(
                (input) => `
                  <div>
                    <span>${input.kind}</span>
                    <strong>${input.value}</strong>
                  </div>
                `,
              )
              .join("")}
          </div>
        </section>
        <section class="candidate-panel">
          <span class="step-label">Eligibility → ranking</span>
          <h3>Candidate comparison</h3>
          <p class="column-description">Only eligible candidates are passed to the model.</p>
          <table class="candidate-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Candidate</th>
                <th>Price</th>
                <th>Eligibility</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              ${scenario.candidates
                .map(
                  ([emoji, name, price, score, eligibility], index) => `
                    <tr class="${index === 0 ? "winner" : ""}">
                      <td><span class="rank-pill">${index + 1}</span></td>
                      <td><span class="candidate-name">${emoji} ${name}</span></td>
                      <td>${money(price)}</td>
                      <td>${eligibility}</td>
                      <td>
                        <div class="mini-score">
                          <div class="mini-track"><i style="width:${score * 100}%"></i></div>
                          <strong>${score.toFixed(2)}</strong>
                        </div>
                      </td>
                    </tr>
                  `,
                )
                .join("")}
            </tbody>
          </table>
        </section>
        <section class="why-panel">
          <span class="step-label">Explanation</span>
          <h3>Why this won</h3>
          <div class="why-list">
            ${scenario.why
              .map(
                (reason, index) => `
                  <div><b>${index + 1}</b><span>${reason}</span></div>
                `,
              )
              .join("")}
          </div>
          ${outputCard(scenario)}
        </section>
      </div>
      <div class="contract-strip">
        ${scenario.contract
          .map(
            ([label, value]) => `
              <div><span>${label}</span><strong>${value}</strong></div>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderScenarioTabs() {
  const tabs = document.querySelector("#scenario-tabs");
  tabs.innerHTML = Object.entries(scenarios)
    .map(
      ([key, scenario]) => `
        <button
          type="button"
          class="scenario-tab ${state.scenario === key ? "active" : ""}"
          data-scenario="${key}"
        >${scenario.shortLabel}</button>
      `,
    )
    .join("");

  tabs.querySelectorAll("[data-scenario]").forEach((button) => {
    button.addEventListener("click", () => {
      state.scenario = button.dataset.scenario;
      updateUrl();
      render();
    });
  });
}

function renderVariantOptions() {
  const options = document.querySelector("#variant-options");
  options.innerHTML = variants
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
  options.querySelectorAll("[data-variant]").forEach((button) => {
    button.addEventListener("click", () => {
      state.variant = button.dataset.variant;
      updateUrl();
      render();
    });
  });
}

function moveVariant(direction) {
  const index = variants.findIndex(([key]) => key === state.variant);
  state.variant =
    variants[(index + direction + variants.length) % variants.length][0];
  updateUrl();
  render();
}

function render() {
  const scenario = scenarios[state.scenario];
  const root = document.querySelector("#prototype-root");
  root.innerHTML =
    state.variant === "A"
      ? variantA(scenario)
      : state.variant === "B"
        ? variantB(scenario)
        : variantC(scenario);
  renderScenarioTabs();
  renderVariantOptions();
}

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
    target?.isContentEditable;
  if (editing) return;
  if (event.key === "ArrowLeft") moveVariant(-1);
  if (event.key === "ArrowRight") moveVariant(1);
});

render();
