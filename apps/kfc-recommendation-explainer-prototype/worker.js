// THROWAWAY PROTOTYPE — local D1 only. Never deploy this Worker.
const catalog = [
  {
    id: "combo-spicy",
    name: "Combo Gà Giòn Cay",
    emoji: "🍗",
    category: "combo",
    priceVnd: 99000,
    popularity: 0.84,
    lunchFit: 0.88,
    modifiers: ["extra-cheese", "hot-sauce"],
  },
  {
    id: "burger-zinger",
    name: "Burger Zinger",
    emoji: "🍔",
    category: "burger",
    priceVnd: 59000,
    popularity: 0.79,
    lunchFit: 0.9,
    modifiers: ["extra-cheese", "hash-brown", "hot-sauce"],
  },
  {
    id: "bucket-6",
    name: "Bucket 6 Miếng",
    emoji: "🪣",
    category: "bucket",
    priceVnd: 189000,
    popularity: 0.91,
    lunchFit: 0.64,
    modifiers: [],
  },
  {
    id: "fries-medium",
    name: "Khoai Tây Chiên Vừa",
    emoji: "🍟",
    category: "side",
    priceVnd: 35000,
    popularity: 0.83,
    lunchFit: 0.82,
    modifiers: [],
  },
  {
    id: "popcorn",
    name: "Gà Popcorn",
    emoji: "🍿",
    category: "side",
    priceVnd: 49000,
    popularity: 0.75,
    lunchFit: 0.76,
    modifiers: [],
  },
  {
    id: "pepsi",
    name: "Pepsi Lon",
    emoji: "🥤",
    category: "drink",
    priceVnd: 25000,
    popularity: 0.71,
    lunchFit: 0.8,
    modifiers: [],
  },
];

const modifiers = [
  {
    id: "extra-cheese",
    name: "Thêm Phô Mai",
    emoji: "🧀",
    priceVnd: 12000,
    acceptance: 0.84,
  },
  {
    id: "hash-brown",
    name: "Thêm Hash Brown",
    emoji: "🥔",
    priceVnd: 19000,
    acceptance: 0.76,
  },
  {
    id: "hot-sauce",
    name: "Thêm Sốt Cay",
    emoji: "🌶️",
    priceVnd: 8000,
    acceptance: 0.67,
  },
];

const trainingEvidence = {
  syntheticDisclaimer:
    "Synthetic behavioral-world evidence only; not real KFC uplift.",
  dataset: {
    kind: "generated_fixture_behavior",
    journeys: 50000,
    seeds: 10,
    observations: [
      "recommendation opportunities",
      "candidate eligibility",
      "impressions",
      "selections and dismissals",
      "cart outcomes",
      "completed checkout value",
    ],
  },
  placements: {
    smartCrossSell: {
      model: "LightGBM",
      trained: true,
      learnedWinner: true,
      servingAuthority: "prototype_baseline",
      promotion: "retain_baseline",
      result:
        "Expected incremental AOV improved, but the relevance guardrail regressed.",
      digest:
        "e76c7641d48a9f47f0da084ca77f30ceb8df6c31c2ebee65eef15d52c80cda80",
    },
    modifierUpsell: {
      model: "Keras",
      trained: true,
      learnedWinner: true,
      servingAuthority: "prototype_baseline",
      promotion: "retain_baseline",
      result:
        "The AOV delta confidence interval crossed zero, so the learned model was not promoted.",
      digest:
        "75f1d02a4e230e901eb222b26268b255f46842483ad77f04e2192ea74d81de26",
    },
    forYou: {
      model: null,
      trained: false,
      learnedWinner: false,
      servingAuthority: "prototype_baseline",
      promotion: "not_qualified",
      result: "No qualified learned artifact is currently registered.",
      digest: null,
    },
    localFavorites: {
      model: null,
      trained: false,
      learnedWinner: false,
      servingAuthority: "prototype_baseline",
      promotion: "not_qualified",
      result: "No qualified learned artifact is currently registered.",
      digest: null,
    },
  },
};

function json(value, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(value), { ...init, headers });
}

async function body(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function profileKey(value) {
  return value === "guest" ? "guest" : "authenticated";
}

function parseJson(value, fallback) {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function publicProfile(row) {
  return {
    profileKey: row.profile_key,
    identity: {
      sessionId:
        row.profile_key === "guest"
          ? "prototype-guest-session"
          : "prototype-auth-session",
      customerRef: row.customer_ref,
      linked: row.linked === 1,
      personalizationEligible: row.linked === 1,
    },
    cart: {
      revision: row.cart_revision,
      lines: parseJson(row.cart_json, []),
    },
    completedOrders: parseJson(row.completed_orders_json, []),
    checkoutOutcomes: parseJson(row.checkout_outcomes_json, []),
    lastDecision: parseJson(row.last_decision_json, null),
    updatedAt: row.updated_at,
  };
}

async function loadProfile(env, key) {
  const row = await env.DB.prepare(
    `SELECT profile_key, customer_ref, linked, cart_json, cart_revision,
            completed_orders_json, checkout_outcomes_json, last_decision_json,
            updated_at
       FROM prototype_recommendation_profiles
      WHERE profile_key = ?1`,
  )
    .bind(key)
    .first();
  if (!row) throw new Error(`prototype profile ${key} is missing`);
  return publicProfile(row);
}

async function saveProfile(env, profile) {
  await env.DB.prepare(
    `UPDATE prototype_recommendation_profiles
        SET cart_json = ?2,
            cart_revision = ?3,
            completed_orders_json = ?4,
            checkout_outcomes_json = ?5,
            last_decision_json = ?6,
            updated_at = ?7
      WHERE profile_key = ?1`,
  )
    .bind(
      profile.profileKey,
      JSON.stringify(profile.cart.lines),
      profile.cart.revision,
      JSON.stringify(profile.completedOrders),
      JSON.stringify(profile.checkoutOutcomes),
      profile.lastDecision ? JSON.stringify(profile.lastDecision) : null,
      profile.updatedAt,
    )
    .run();
}

function subtotal(profile) {
  return profile.cart.lines.reduce(
    (total, line) => total + line.priceVnd * line.quantity,
    0,
  );
}

function enrichedState(profile) {
  return {
    ...profile,
    cart: { ...profile.cart, subtotalVnd: subtotal(profile) },
  };
}

function findCatalogItem(itemId) {
  return catalog.find((item) => item.id === itemId);
}

async function mutateCart(request, env) {
  const input = await body(request);
  const key = profileKey(input.profileKey);
  const profile = await loadProfile(env, key);
  const item = findCatalogItem(input.itemId);
  if (!item) return json({ error: "unknown_item" }, { status: 400 });
  const existing = profile.cart.lines.find((line) => line.itemId === item.id);
  if (existing) {
    existing.quantity += 1;
  } else {
    profile.cart.lines.push({
      lineId: `line-${profile.cart.revision + 1}-${item.id}`,
      itemId: item.id,
      name: item.name,
      emoji: item.emoji,
      category: item.category,
      priceVnd: item.priceVnd,
      quantity: 1,
      modifiers: [],
    });
  }
  profile.cart.revision += 1;
  profile.lastDecision = null;
  profile.updatedAt = new Date().toISOString();
  await saveProfile(env, profile);
  return json(enrichedState(profile));
}

async function removeCartLine(request, env) {
  const input = await body(request);
  const key = profileKey(input.profileKey);
  const profile = await loadProfile(env, key);
  const before = profile.cart.lines.length;
  profile.cart.lines = profile.cart.lines.filter(
    (line) => line.lineId !== input.lineId,
  );
  if (profile.cart.lines.length === before) {
    return json({ error: "unknown_cart_line" }, { status: 404 });
  }
  profile.cart.revision += 1;
  profile.lastDecision = null;
  profile.updatedAt = new Date().toISOString();
  await saveProfile(env, profile);
  return json(enrichedState(profile));
}

async function checkout(request, env) {
  const input = await body(request);
  const key = profileKey(input.profileKey);
  const profile = await loadProfile(env, key);
  if (profile.cart.lines.length === 0) {
    return json({ error: "cart_empty" }, { status: 409 });
  }
  const order = {
    orderId: `prototype-order-${crypto.randomUUID().slice(0, 8)}`,
    completedAt: new Date().toISOString(),
    lines: structuredClone(profile.cart.lines),
    totalVnd: subtotal(profile),
    reusableForPersonalization: profile.identity.linked,
  };
  profile.checkoutOutcomes.unshift(order);
  if (profile.identity.linked) profile.completedOrders.unshift(order);
  profile.cart.lines = [];
  profile.cart.revision += 1;
  profile.lastDecision = null;
  profile.updatedAt = new Date().toISOString();
  await saveProfile(env, profile);
  return json({ state: enrichedState(profile), completedOrder: order });
}

async function resetProfile(request, env) {
  const input = await body(request);
  const key = profileKey(input.profileKey);
  await env.DB.prepare(
    `UPDATE prototype_recommendation_profiles
        SET cart_json = '[]',
            cart_revision = 0,
            completed_orders_json = '[]',
            checkout_outcomes_json = '[]',
            last_decision_json = NULL,
            updated_at = ?2
      WHERE profile_key = ?1`,
  )
    .bind(key, new Date().toISOString())
    .run();
  return json(enrichedState(await loadProfile(env, key)));
}

function candidateFromItem(item, extra = {}) {
  return {
    actionId: `add:${item.id}`,
    itemId: item.id,
    name: item.name,
    emoji: item.emoji,
    category: item.category,
    priceVnd: item.priceVnd,
    eligible: true,
    rejectionReasons: [],
    ...extra,
  };
}

function localFavoritesDecision(profile) {
  const candidates = catalog
    .map((item) =>
      candidateFromItem(item, {
        features: {
          storePopularity: item.popularity,
          lunchFit: item.lunchFit,
          availability: 1,
        },
        score: item.popularity * 0.7 + item.lunchFit * 0.3,
      }),
    )
    .sort((left, right) => right.score - left.score);
  return makeDecision(profile, "localFavorites", candidates, {
    inputs: {
      storeId: "store-district-1",
      localHour: 12,
      customerHistorySupplied: false,
      catalogRevision: "synthetic-catalog-v1",
    },
    eligibilityRules: ["available_now", "valid_kiosk_product"],
    modelEvidence: trainingEvidence.placements.localFavorites,
  });
}

function forYouDecision(profile) {
  if (!profile.identity.linked || profile.completedOrders.length === 0) {
    return makeEmptyDecision(profile, "forYou", {
      emptyReason: "verified_completed_order_history_required",
      inputs: {
        customerRef: profile.identity.customerRef,
        linked: profile.identity.linked,
        completedOrderCount: profile.completedOrders.length,
      },
      modelEvidence: trainingEvidence.placements.forYou,
    });
  }
  const priorItems = new Set(
    profile.completedOrders.flatMap((order) =>
      order.lines.map((line) => line.itemId),
    ),
  );
  const priorCategories = new Set(
    profile.completedOrders.flatMap((order) =>
      order.lines.map((line) => line.category),
    ),
  );
  const candidates = catalog
    .map((item) =>
      candidateFromItem(item, {
        features: {
          priorItemAffinity: priorItems.has(item.id) ? 1 : 0,
          priorCategoryAffinity: priorCategories.has(item.category) ? 1 : 0,
          complementaryHistory:
            priorCategories.has("burger") && item.category === "combo" ? 1 : 0,
          storePopularity: item.popularity,
          lunchFit: item.lunchFit,
        },
        score:
          item.popularity * 0.3 +
          item.lunchFit * 0.2 +
          (priorItems.has(item.id) ? 0.18 : 0) +
          (priorCategories.has(item.category) ? 0.12 : 0) +
          (priorCategories.has("burger") && item.category === "combo"
            ? 0.22
            : 0),
      }),
    )
    .sort((left, right) => right.score - left.score);
  return makeDecision(profile, "forYou", candidates, {
    inputs: {
      customerRef: profile.identity.customerRef,
      linked: true,
      completedOrderCount: profile.completedOrders.length,
      priorItemIds: [...priorItems],
      priorCategories: [...priorCategories],
      storeId: "store-district-1",
    },
    eligibilityRules: [
      "verified_history",
      "available_now",
      "valid_kiosk_product",
    ],
    modelEvidence: trainingEvidence.placements.forYou,
  });
}

function modifierDecision(profile, parentCartLineId) {
  const parent = profile.cart.lines.find(
    (line) => line.lineId === parentCartLineId,
  );
  if (!parent) {
    return makeEmptyDecision(profile, "modifierUpsell", {
      emptyReason: "valid_parent_cart_line_required",
      inputs: {
        parentCartLineId: parentCartLineId || null,
        availableCartLineIds: profile.cart.lines.map((line) => line.lineId),
      },
      modelEvidence: trainingEvidence.placements.modifierUpsell,
    });
  }
  const item = findCatalogItem(parent.itemId);
  const selectedIds = new Set(parent.modifiers.map((modifier) => modifier.id));
  const candidates = modifiers
    .map((modifier) => ({
      actionId: `apply_modifier:${parent.lineId}:${modifier.id}`,
      itemId: modifier.id,
      name: modifier.name,
      emoji: modifier.emoji,
      category: "modifier",
      priceVnd: modifier.priceVnd,
      eligible:
        Boolean(item?.modifiers.includes(modifier.id)) &&
        !selectedIds.has(modifier.id),
      rejectionReasons: [
        ...(!item?.modifiers.includes(modifier.id)
          ? ["incompatible_with_parent"]
          : []),
        ...(selectedIds.has(modifier.id) ? ["already_selected"] : []),
      ],
      features: {
        parentItemId: parent.itemId,
        compatible: item?.modifiers.includes(modifier.id) ? 1 : 0,
        historicalAcceptance: modifier.acceptance,
        priceDeltaVnd: modifier.priceVnd,
      },
      score:
        modifier.acceptance * 0.75 +
        Math.min(modifier.priceVnd / 20000, 1) * 0.25,
    }))
    .sort((left, right) => right.score - left.score);
  return makeDecision(profile, "modifierUpsell", candidates, {
    inputs: {
      parentCartLineId: parent.lineId,
      parentItemId: parent.itemId,
      alreadySelectedModifierIds: [...selectedIds],
      storeId: "store-district-1",
    },
    eligibilityRules: [
      "compatible_modifier",
      "available_now",
      "not_already_selected",
      "positive_price_delta",
    ],
    modelEvidence: trainingEvidence.placements.modifierUpsell,
  });
}

function smartCrossSellDecision(profile) {
  if (profile.cart.lines.length === 0) {
    return makeEmptyDecision(profile, "smartCrossSell", {
      emptyReason: "non_empty_cart_required",
      inputs: { cartRevision: profile.cart.revision, cartLines: [] },
      modelEvidence: trainingEvidence.placements.smartCrossSell,
    });
  }
  const cartItems = new Set(profile.cart.lines.map((line) => line.itemId));
  const cartCategories = new Set(
    profile.cart.lines.map((line) => line.category),
  );
  const candidates = catalog
    .map((item) =>
      candidateFromItem(item, {
        eligible: !cartItems.has(item.id),
        rejectionReasons: cartItems.has(item.id)
          ? ["already_in_cart"]
          : [],
        features: {
          alreadyInCart: cartItems.has(item.id) ? 1 : 0,
          basketComplement:
            (item.category === "side" &&
              [...cartCategories].some((category) =>
                ["burger", "combo", "bucket"].includes(category),
              )) ||
            (item.category === "drink" && !cartCategories.has("drink"))
              ? 1
              : 0,
          storeCoPurchase: item.category === "side" ? 0.86 : 0.63,
          lunchFit: item.lunchFit,
          priceDeltaVnd: item.priceVnd,
        },
        score:
          (item.category === "side" ? 0.36 : 0.2) +
          (item.category === "drink" && !cartCategories.has("drink")
            ? 0.22
            : 0) +
          item.popularity * 0.24 +
          item.lunchFit * 0.18,
      }),
    )
    .sort((left, right) => right.score - left.score);
  return makeDecision(profile, "smartCrossSell", candidates, {
    inputs: {
      cartRevision: profile.cart.revision,
      cartSubtotalVnd: subtotal(profile),
      cartItemIds: [...cartItems],
      cartCategories: [...cartCategories],
      storeId: "store-district-1",
      localHour: 12,
    },
    eligibilityRules: [
      "available_now",
      "not_already_in_cart",
      "valid_kiosk_product",
    ],
    modelEvidence: trainingEvidence.placements.smartCrossSell,
  });
}

function makeEmptyDecision(profile, type, extra) {
  return {
    requestId: `prototype-request-${crypto.randomUUID().slice(0, 8)}`,
    recommendationId: null,
    type,
    status: "empty",
    createdAt: new Date().toISOString(),
    cartRevision: profile.cart.revision,
    recommendations: [],
    stages: [
      { name: "request_snapshot", status: "completed", data: extra.inputs },
      {
        name: "prerequisite_gate",
        status: "empty",
        data: { reason: extra.emptyReason },
      },
    ],
    ...extra,
  };
}

function makeDecision(profile, type, candidates, extra) {
  const eligible = candidates.filter((candidate) => candidate.eligible);
  const limit =
    type === "modifierUpsell" || type === "forYou"
      ? 3
      : type === "smartCrossSell" || type === "localFavorites"
        ? 4
        : 1;
  const recommendations = eligible.slice(0, limit);
  return {
    requestId: `prototype-request-${crypto.randomUUID().slice(0, 8)}`,
    recommendationId: `prototype-recommendation-${crypto.randomUUID().slice(0, 8)}`,
    type,
    status: recommendations.length === 0 ? "empty" : "completed",
    createdAt: new Date().toISOString(),
    cartRevision: profile.cart.revision,
    inputs: extra.inputs,
    modelEvidence: extra.modelEvidence,
    candidates,
    recommendations,
    stages: [
      {
        name: "request_snapshot",
        status: "completed",
        data: extra.inputs,
      },
      {
        name: "candidate_enumeration",
        status: "completed",
        data: { count: candidates.length },
      },
      {
        name: "deterministic_eligibility",
        status: "completed",
        data: {
          rules: extra.eligibilityRules,
          eligibleCount: eligible.length,
          rejectedCount: candidates.length - eligible.length,
        },
      },
      {
        name: "feature_building",
        status: "completed",
        data: {
          featureNames: [
            ...new Set(
              eligible.flatMap((candidate) =>
                Object.keys(candidate.features ?? {}),
              ),
            ),
          ],
        },
      },
      {
        name: "ranking",
        status: "completed",
        data: {
          authority: extra.modelEvidence.servingAuthority,
          trainedModel: extra.modelEvidence.model,
          learnedModelPromoted: false,
        },
      },
      {
        name: "selection",
        status: recommendations.length > 0 ? "completed" : "empty",
        data: {
          selectedActionIds: recommendations.map(
            (recommendation) => recommendation.actionId,
          ),
        },
      },
    ],
  };
}

async function recommend(request, env, type) {
  const input = await body(request);
  const key = profileKey(input.profileKey);
  const profile = await loadProfile(env, key);
  const decision =
    type === "localFavorites"
      ? localFavoritesDecision(profile)
      : type === "forYou"
        ? forYouDecision(profile)
        : type === "modifierUpsell"
          ? modifierDecision(profile, input.parentCartLineId)
          : smartCrossSellDecision(profile);
  profile.lastDecision = decision;
  profile.updatedAt = new Date().toISOString();
  await saveProfile(env, profile);
  return json({ decision, state: enrichedState(profile) });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/catalog" && request.method === "GET") {
      return json({ catalog, modifiers });
    }
    if (url.pathname === "/api/training" && request.method === "GET") {
      return json(trainingEvidence);
    }
    if (url.pathname === "/api/state" && request.method === "GET") {
      return json(
        enrichedState(
          await loadProfile(env, profileKey(url.searchParams.get("profileKey"))),
        ),
      );
    }
    if (url.pathname === "/api/cart/add" && request.method === "POST") {
      return mutateCart(request, env);
    }
    if (url.pathname === "/api/cart/remove" && request.method === "POST") {
      return removeCartLine(request, env);
    }
    if (url.pathname === "/api/checkout" && request.method === "POST") {
      return checkout(request, env);
    }
    if (url.pathname === "/api/reset" && request.method === "POST") {
      return resetProfile(request, env);
    }
    const match = url.pathname.match(
      /^\/api\/recommendations\/(localFavorites|forYou|modifierUpsell|smartCrossSell)$/,
    );
    if (match && request.method === "POST") {
      return recommend(request, env, match[1]);
    }
    return env.ASSETS.fetch(request);
  },
};
