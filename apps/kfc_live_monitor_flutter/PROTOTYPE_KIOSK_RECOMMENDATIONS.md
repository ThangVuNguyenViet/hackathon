# KFC kiosk recommendation journey prototype

This is throwaway UI exploration for Wayfinder issue 100. It does not change
the production customer chat or monitor entrypoints, call a live model, persist
state, or claim real KFC uplift.

Run it with one command:

```sh
./tool/run_kiosk_prototype.sh
```

Open `http://127.0.0.1:8512/?variant=A` and use the bottom switcher or the left
and right arrow keys:

- A — large guided recommendation moments;
- B — a persistent contextual recommendation rail;
- C — recommendation modules embedded in cart review.

The Returning customer control demonstrates For You. Anonymous demonstrates
Local Favorites. Add a starter, accept or dismiss a Modifier Upsell, then add
or dismiss one Smart Cross-sell item. Presenter evidence explains each
contract-shaped endpoint request, the kiosk-owned cart mutation, synthetic
model provenance, and relative basket change.
