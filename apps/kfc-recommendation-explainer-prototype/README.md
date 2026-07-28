# KFC recommendation-engine workbench prototype

This is a throwaway HTML + local Cloudflare D1 prototype for
[Prototype the recommendation-engine demo workbench](https://github.com/ThangVuNguyenViet/hackathon/issues/100).

It lets a presenter:

- toggle between an authenticated demo customer and an unlinked guest;
- add and remove menu products from a real scratch local D1 cart;
- checkout an authenticated cart to create reusable previous-order history;
- observe that a guest checkout remains unlinked from personalization;
- invoke Local Favorites, For You, Modifier Upsell, or Smart Cross-sell
  independently;
- inspect request inputs, deterministic eligibility, model-visible features,
  scores, ranked output, current serving authority, and training evidence.

This is not a kiosk ordering journey. It does not enforce recommendation order.
The recommendation scores are prototype baselines. Smart Cross-sell and
Modifier Upsell expose the repository's real synthetic qualification status;
their learned models are not presented as promoted customer-serving authority.

Run:

```sh
./serve.sh
```

Open:

```text
http://127.0.0.1:8512/?recommendation=smartCrossSell&variant=A
```

Independent recommendation requests:

- `forYou`
- `localFavorites`
- `modifierUpsell`
- `smartCrossSell`

Workbench variants:

- A — three-panel commerce, engine, and D1 workbench;
- B — engine-first studio with commerce and state stacked beside it;
- C — state-first console with commerce and engine alongside.

The `serve.sh` command creates only the local Wrangler D1 database declared by
this prototype. Never deploy its Worker or point it at a remote database.

## Recommended three-minute demo

1. Start on **Authenticated** and press **Reset profile**.
2. Add Burger Zinger and Pepsi, then press **Checkout**. Point out that the
   cart becomes a completed order in the D1 inspector.
3. Open **For You** and run the request. Explain the result from left to right:
   the durable history snapshot, candidate eligibility, feature values, scores,
   and ranked output.
4. Add Burger Zinger again, open **Modifier Upsell**, select its cart-line ID,
   and run the request. The parent line is request context supplied by the
   integrating kiosk, not an ordering stage owned by the engine.
5. Open **Smart Cross-sell** and run it against the same cart. The current
   burger is rejected as already in the cart, and the engine returns the four
   highest-ranked eligible complements.
6. Toggle to **Guest**, reset it, and run **For You**. The typed empty result
   demonstrates that unlinked guest checkout data is not treated as verified
   customer history.
7. Open **How the models were trained**. State that the evidence comes from a
   synthetic fixture world: 50,000 journeys across 10 seeds. LightGBM
   Smart Cross-sell and Keras Modifier Upsell artifacts were trained, but their
   qualification gates retained the deterministic baseline. Local Favorites
   and For You do not yet have qualified learned artifacts.

## Engine boundary

Every recommendation endpoint follows the same independent contract:

```text
current request + durable snapshot
  → enumerate placement-specific candidates
  → apply deterministic eligibility
  → build model-visible features
  → rank eligible actions
  → select a bounded slate or return a typed empty result
```

The kiosk integration will decide when to call an endpoint. The recommendation
engine does not own the kiosk journey or require Local Favorites, For You,
Modifier Upsell, and Smart Cross-sell to run in a particular order.
