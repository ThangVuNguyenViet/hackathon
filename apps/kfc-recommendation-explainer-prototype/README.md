# KFC recommendation explainer prototype

This is a throwaway static HTML prototype for Wayfinder issue 100.

It answers one question:

> How can a presenter show one recommended item and explain which request
> inputs, eligibility rules, and learned ranking signals led to it?

It is intentionally not a kiosk ordering journey. Every scenario is an
independent recommendation-engine request. The page uses synthetic fixture
data and does not call a live model or claim real KFC uplift.

Run:

```sh
./serve.sh
```

Open:

```text
http://127.0.0.1:8512/?scenario=smartCrossSell&variant=A
```

Independent scenarios:

- `forYou`
- `localFavorites`
- `modifierUpsell`
- `smartCrossSell`

Explanation variants:

- A — left-to-right decision pipeline;
- B — influence map around the recommended output;
- C — evidence-first candidate scorecard.
