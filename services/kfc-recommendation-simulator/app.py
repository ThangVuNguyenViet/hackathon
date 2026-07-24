from __future__ import annotations

import argparse
import html
import json
from pathlib import Path
from typing import Any

import pyarrow.parquet as pq
import streamlit as st
import streamlit.components.v1 as components

# PROTOTYPE QUESTION:
# Three variants, switchable via ?variant=, test how a presenter should explain
# synthetic context -> recommendation -> customer response on the existing page.

VARIANTS = {
    "A": "Guided story",
    "B": "Kiosk theatre",
    "C": "Evidence board",
}
SCENARIOS = {
    "journey-000026": {
        "label": "Quick lunch · cross-sell accepted",
        "placement": "smart_cross_sell",
        "note": "A clean end-to-end success: the primary suggestion is accepted.",
    },
    "journey-000000": {
        "label": "Family meal · modifier declined",
        "placement": "modifier_upsell",
        "note": "A rejection case: negative feedback is useful evidence too.",
    },
    "journey-000001": {
        "label": "Treat mission · local favorite accepted",
        "placement": "local_favorites",
        "note": "A broader discovery placement with five displayed options.",
    },
}
PLACEMENT_LABELS = {
    "local_favorites": "Local favorites",
    "smart_cross_sell": "Smart cross-sell",
    "modifier_upsell": "Modifier upsell",
    "sanity_single_upsell": "Single product offer",
}
POLICY_REASONS = {
    "popularity": "Popular for this ordering moment",
    "basket_association": "Frequently paired with the current basket",
    "promotion_biased": "Strong value signal for this basket",
    "randomized_exploration": "Exploration candidate used to learn preferences",
}


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument(
        "--bundle",
        type=Path,
        default=Path("../../.artifacts/kfc-recommendation-simulator/smoke"),
    )
    return parser.parse_known_args()[0]


def _rows(path: Path) -> list[dict[str, Any]]:
    return pq.read_table(path).to_pylist()


@st.cache_data(show_spinner=False)
def _load_bundle(bundle_path: str) -> dict[str, Any]:
    root = Path(bundle_path)
    return {
        "manifest": json.loads(
            (root / "manifest.json").read_text(encoding="utf-8")
        ),
        "audit": json.loads((root / "audit.json").read_text(encoding="utf-8")),
        "requests": _rows(root / "model-visible" / "requests.parquet"),
        "candidates": _rows(root / "model-visible" / "candidates.parquet"),
        "impressions": _rows(root / "model-visible" / "impressions.parquet"),
        "outcomes": _rows(root / "model-visible" / "outcomes.parquet"),
    }


@st.cache_data(show_spinner=False)
def _load_oracle(bundle_path: str) -> list[dict[str, Any]]:
    return _rows(Path(bundle_path) / "oracle" / "counterfactuals.parquet")


def _money(value: object) -> str:
    return f"{int(value):,}₫"


def _safe(value: object) -> str:
    return html.escape(str(value))


def _scenario_data(
    data: dict[str, Any],
    journey_id: str,
    placement: str,
) -> tuple[
    dict[str, Any],
    dict[str, Any],
    list[dict[str, Any]],
    dict[str, dict[str, Any]],
]:
    request = next(
        row for row in data["requests"] if row["journey_id"] == journey_id
    )
    outcome = next(
        row
        for row in data["outcomes"]
        if row["journey_id"] == journey_id and row["placement"] == placement
    )
    slate = sorted(
        (
            row
            for row in data["impressions"]
            if row["request_id"] == outcome["request_id"]
        ),
        key=lambda row: int(row["position"]),
    )
    candidate_lookup = {
        row["candidate_id"]: row
        for row in data["candidates"]
        if row["request_id"] == outcome["request_id"]
    }
    return request, outcome, slate, candidate_lookup


def _selected_name(
    outcome: dict[str, Any],
    candidate_lookup: dict[str, dict[str, Any]],
) -> str:
    selected = outcome["selected_candidate_id"]
    return (
        str(candidate_lookup[selected]["name"])
        if selected
        else "No recommendation selected"
    )


def _inject_style() -> None:
    st.markdown(
        """
        <style>
        @import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=DM+Sans:opsz,wght@9..40,400;9..40,600;9..40,700&display=swap');

        :root {
          --paper: #f7f0df;
          --ink: #181411;
          --red: #d61920;
          --red-dark: #8f0f13;
          --mustard: #f0b323;
          --cream: #fffaf0;
          --muted: #746b5d;
          --green: #16734a;
        }
        .stApp {
          background:
            radial-gradient(circle at 82% 8%, rgba(240,179,35,.18), transparent 24rem),
            linear-gradient(135deg, rgba(214,25,32,.035) 25%, transparent 25%) 0 0/22px 22px,
            var(--paper);
          color: var(--ink);
          font-family: 'DM Sans', sans-serif;
        }
        [data-testid="stHeader"] { background: transparent; }
        [data-testid="stMainBlockContainer"] {
          max-width: 1180px;
          padding-top: 2.4rem;
          padding-bottom: 7rem;
        }
        h1, h2, h3 {
          font-family: 'Archivo Black', sans-serif !important;
          letter-spacing: -.035em;
          color: var(--ink) !important;
        }
        h1 { font-size: clamp(2.35rem, 5vw, 4.8rem) !important; line-height: .95 !important; }
        p, label, [data-testid="stMetricLabel"] { font-family: 'DM Sans', sans-serif !important; }
        [data-testid="stMetric"] {
          background: rgba(255,250,240,.78);
          border: 1px solid rgba(24,20,17,.13);
          border-radius: 0;
          padding: 1rem;
          box-shadow: 5px 5px 0 rgba(24,20,17,.09);
        }
        [data-testid="stMetricValue"] { font-family: 'Archivo Black', sans-serif; }
        .stButton > button {
          border-radius: 0;
          border: 2px solid var(--ink);
          background: var(--red);
          color: white;
          font-weight: 800;
          min-height: 3.15rem;
          box-shadow: 5px 5px 0 var(--ink);
          transition: transform .12s ease, box-shadow .12s ease;
        }
        .stButton > button:hover {
          border-color: var(--ink);
          color: white;
          background: var(--red-dark);
          transform: translate(2px, 2px);
          box-shadow: 3px 3px 0 var(--ink);
        }
        [data-baseweb="select"] > div {
          border-radius: 0 !important;
          border-color: rgba(24,20,17,.35) !important;
          background: var(--cream) !important;
        }
        .demo-kicker {
          display: inline-flex;
          align-items: center;
          gap: .45rem;
          background: var(--ink);
          color: white;
          padding: .42rem .72rem;
          font-size: .72rem;
          font-weight: 800;
          letter-spacing: .11em;
          text-transform: uppercase;
        }
        .demo-kicker::before {
          content: "";
          width: .55rem;
          height: .55rem;
          border-radius: 50%;
          background: var(--mustard);
        }
        .hero-copy {
          max-width: 760px;
          color: var(--muted);
          font-size: 1.08rem;
          line-height: 1.65;
          margin: .7rem 0 1.3rem;
        }
        .step-strip {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: .55rem;
          margin: 1.5rem 0 2rem;
        }
        .step-chip {
          border-top: 5px solid rgba(24,20,17,.18);
          padding: .72rem .2rem 0;
          color: var(--muted);
          font-size: .82rem;
          font-weight: 800;
          letter-spacing: .06em;
          text-transform: uppercase;
        }
        .step-chip.on { border-color: var(--red); color: var(--ink); }
        .context-card, .receipt, .evidence-card {
          background: rgba(255,250,240,.9);
          border: 2px solid var(--ink);
          padding: 1.35rem;
          box-shadow: 7px 7px 0 rgba(24,20,17,.12);
          margin: .5rem 0 1.1rem;
        }
        .context-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 1rem;
        }
        .eyebrow {
          color: var(--red);
          font-size: .72rem;
          font-weight: 800;
          letter-spacing: .1em;
          text-transform: uppercase;
          margin-bottom: .25rem;
        }
        .context-value { font-weight: 800; line-height: 1.25; }
        .basket-line {
          margin-top: 1rem;
          border-top: 1px dashed rgba(24,20,17,.3);
          padding-top: .9rem;
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          font-weight: 800;
        }
        .primary-rec {
          position: relative;
          overflow: hidden;
          background: var(--red);
          color: white;
          border: 2px solid var(--ink);
          padding: 1.75rem;
          box-shadow: 8px 8px 0 var(--ink);
          margin: .7rem 0 1.2rem;
        }
        .primary-rec::after {
          content: "01";
          position: absolute;
          right: -1rem;
          bottom: -2.2rem;
          color: rgba(255,255,255,.12);
          font-family: 'Archivo Black', sans-serif;
          font-size: 9rem;
          line-height: 1;
        }
        .primary-rec .name {
          position: relative;
          z-index: 1;
          font-family: 'Archivo Black', sans-serif;
          font-size: clamp(1.6rem, 3.2vw, 2.65rem);
          line-height: 1;
          max-width: 720px;
          overflow-wrap: anywhere;
          padding-right: 3rem;
        }
        .primary-rec .price {
          position: relative;
          z-index: 1;
          color: var(--mustard);
          font-family: 'Archivo Black', sans-serif;
          font-size: 1.45rem;
          margin-top: .8rem;
        }
        .primary-rec .reason {
          position: relative;
          z-index: 1;
          margin-top: .35rem;
          opacity: .84;
        }
        .alternatives {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: .65rem;
          margin-bottom: 1rem;
        }
        .alt-card {
          background: var(--cream);
          border: 1px solid rgba(24,20,17,.25);
          padding: .9rem 1rem;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: .7rem;
          font-weight: 700;
        }
        .outcome-success, .outcome-neutral {
          padding: 1.25rem;
          border: 2px solid var(--ink);
          box-shadow: 7px 7px 0 var(--ink);
          margin: .7rem 0 1.2rem;
        }
        .outcome-success { background: var(--green); color: white; }
        .outcome-neutral { background: var(--mustard); color: var(--ink); }
        .outcome-title {
          font-family: 'Archivo Black', sans-serif;
          font-size: 1.7rem;
          line-height: 1.05;
        }
        .outcome-meta { margin-top: .55rem; font-weight: 700; }
        .theatre-shell {
          border: 3px solid var(--ink);
          min-height: 580px;
          background: var(--cream);
          box-shadow: 12px 12px 0 var(--red);
          padding: 1.5rem;
        }
        .ticket-rule { border-top: 2px dashed var(--ink); margin: 1rem 0; }
        .ticket-row { display: flex; justify-content: space-between; gap: 1rem; margin: .5rem 0; }
        .empty-stage {
          min-height: 310px;
          display: grid;
          place-items: center;
          border: 2px dashed rgba(24,20,17,.28);
          color: var(--muted);
          text-align: center;
          padding: 2rem;
        }
        .board-grid {
          display: grid;
          grid-template-columns: .9fr 1.2fr .9fr;
          gap: 1rem;
          align-items: stretch;
        }
        .board-stage {
          min-height: 340px;
          border: 2px solid var(--ink);
          padding: 1.2rem;
          background: var(--cream);
          box-shadow: 6px 6px 0 rgba(24,20,17,.12);
        }
        .board-stage.decision { background: var(--red); color: white; }
        .board-number {
          font-family: 'Archivo Black', sans-serif;
          font-size: 4.8rem;
          line-height: .85;
          opacity: .18;
        }
        .board-title {
          font-family: 'Archivo Black', sans-serif;
          font-size: 1.3rem;
          margin: .6rem 0 1rem;
        }
        .prototype-switcher {
          position: fixed;
          z-index: 999999;
          left: 50%;
          bottom: 1.15rem;
          transform: translateX(-50%);
          display: flex;
          align-items: center;
          gap: .35rem;
          background: var(--ink);
          border: 1px solid rgba(255,255,255,.22);
          box-shadow: 0 10px 32px rgba(0,0,0,.28);
          padding: .42rem;
        }
        .prototype-switcher a {
          color: white !important;
          text-decoration: none !important;
          padding: .48rem .72rem;
          font-weight: 800;
        }
        .prototype-switcher .current {
          color: var(--mustard);
          min-width: 150px;
          text-align: center;
          font-size: .78rem;
          letter-spacing: .04em;
          text-transform: uppercase;
        }
        @media (max-width: 780px) {
          .context-grid, .board-grid { grid-template-columns: 1fr; }
          .alternatives { grid-template-columns: 1fr; }
          .step-strip { gap: .25rem; }
          [data-testid="stMainBlockContainer"] { padding-left: 1rem; padding-right: 1rem; }
        }
        </style>
        """,
        unsafe_allow_html=True,
    )


def _header(variant_name: str) -> None:
    st.markdown(
        '<span class="demo-kicker">Synthetic recommendation demo</span>',
        unsafe_allow_html=True,
    )
    st.title("From basket to better next bite.")
    st.markdown(
        (
            '<div class="hero-copy">'
            f"<strong>{_safe(variant_name)}</strong> is a throwaway presentation "
            "shell over reproducible synthetic journeys. It demonstrates the "
            "decision flow; it does not claim production uplift."
            "</div>"
        ),
        unsafe_allow_html=True,
    )


def _scenario_picker(prefix: str) -> tuple[str, dict[str, Any]]:
    journey_id = st.selectbox(
        "Demo scenario",
        options=list(SCENARIOS),
        format_func=lambda value: str(SCENARIOS[value]["label"]),
        key=f"{prefix}_scenario",
        on_change=_reset_stage,
    )
    scenario = SCENARIOS[journey_id]
    st.caption(str(scenario["note"]))
    return journey_id, scenario


def _context_html(request: dict[str, Any]) -> str:
    return f"""
    <div class="context-card">
      <div class="context-grid">
        <div><div class="eyebrow">Store</div><div class="context-value">{_safe(request["store_name"])}</div></div>
        <div><div class="eyebrow">Mission</div><div class="context-value">{_safe(str(request["mission"]).replace("_", " ").title())}</div></div>
        <div><div class="eyebrow">Party</div><div class="context-value">{_safe(request["party_size"])} people</div></div>
        <div><div class="eyebrow">Budget</div><div class="context-value">{_money(request["budget_vnd"])}</div></div>
      </div>
      <div class="basket-line">
        <span>Starting basket · {_safe(request["basket_item_name"])}</span>
        <span>{_money(request["basket_subtotal_vnd"])}</span>
      </div>
    </div>
    """


def _recommendation_html(
    slate: list[dict[str, Any]],
    candidate_lookup: dict[str, dict[str, Any]],
) -> str:
    primary_impression = slate[0]
    primary = candidate_lookup[primary_impression["candidate_id"]]
    reason = POLICY_REASONS.get(
        str(primary_impression["logging_policy"]),
        "Eligible for this ordering context",
    )
    alternatives = "".join(
        (
            '<div class="alt-card">'
            f'<span>{_safe(candidate_lookup[row["candidate_id"]]["name"])}</span>'
            f'<span>{_money(candidate_lookup[row["candidate_id"]]["price_delta_vnd"])}</span>'
            "</div>"
        )
        for row in slate[1:]
    )
    return f"""
    <div class="primary-rec">
      <div class="eyebrow" style="color:#f0b323">Primary recommendation</div>
      <div class="name">{_safe(primary["name"])}</div>
      <div class="price">+ {_money(primary["price_delta_vnd"])}</div>
      <div class="reason">{_safe(reason)}</div>
    </div>
    <div class="alternatives">{alternatives}</div>
    """


def _response_html(
    decision: str,
    request: dict[str, Any],
    outcome: dict[str, Any],
    slate: list[dict[str, Any]],
    candidate_lookup: dict[str, dict[str, Any]],
) -> str:
    if decision == "accepted":
        primary = candidate_lookup[slate[0]["candidate_id"]]
        increment = int(primary["price_delta_vnd"])
        basket_after = int(request["basket_subtotal_vnd"]) + increment
        style = "outcome-success"
        eyebrow = "Customer choice"
        title = f"Added · {_safe(primary['name'])}"
        meta = (
            f"Basket {_money(basket_after)} · Ready for checkout "
            f"· Increment {_money(increment)} · Acceptance logged"
        )
    elif decision == "declined":
        style = "outcome-neutral"
        eyebrow = "Customer choice"
        title = "No thanks"
        meta = (
            f"Basket unchanged at {_money(request['basket_subtotal_vnd'])} "
            "· Rejection logged"
        )
    else:
        accepted = outcome["selected_candidate_id"] is not None
        selected_name = _selected_name(outcome, candidate_lookup)
        style = "outcome-success" if accepted else "outcome-neutral"
        eyebrow = "Recorded synthetic response"
        title = (
            f"Auto-played · {_safe(selected_name)}"
            if accepted
            else "Auto-played · No offer accepted"
        )
        checkout = (
            "Checkout completed" if outcome["checked_out"] else "Checkout abandoned"
        )
        meta = (
            f"Basket {_money(outcome['basket_subtotal_after_vnd'])} "
            f"· {checkout} "
            f"· Increment {_money(outcome['gross_incremental_value_vnd'])}"
        )
    return f"""
    <div class="{style}">
      <div class="eyebrow" style="color:inherit">{eyebrow}</div>
      <div class="outcome-title">{title}</div>
      <div class="outcome-meta">{meta}</div>
    </div>
    """


def _reset_stage() -> None:
    st.session_state["demo_stage"] = 0
    st.session_state["demo_decision"] = None


def _step_strip(stage: int) -> None:
    labels = ("1 · Customer context", "2 · Recommendation", "3 · Response")
    cells = "".join(
        f'<div class="step-chip {"on" if stage >= index else ""}">{label}</div>'
        for index, label in enumerate(labels, start=1)
    )
    st.markdown(f'<div class="step-strip">{cells}</div>', unsafe_allow_html=True)


def _variant_guided(data: dict[str, Any]) -> None:
    _header("Guided story")
    st.session_state.setdefault("demo_stage", 0)
    st.session_state.setdefault("demo_decision", None)
    stage = int(st.session_state["demo_stage"])
    _step_strip(stage)
    journey_id, scenario = _scenario_picker("guided")
    request, outcome, slate, lookup = _scenario_data(
        data, journey_id, str(scenario["placement"])
    )

    if stage == 0:
        st.markdown(
            """
            <div class="empty-stage">
              <div>
                <div class="eyebrow">Step one</div>
                <h3>Create a synthetic ordering moment</h3>
                <p>Start with a reproducible customer, store, mission, budget, and basket.</p>
              </div>
            </div>
            """,
            unsafe_allow_html=True,
        )
        if st.button("Simulate customer context", type="primary", use_container_width=True):
            st.session_state["demo_stage"] = 1
            st.rerun()
        return

    st.markdown(_context_html(request), unsafe_allow_html=True)
    if stage == 1:
        st.info(
            f"Recommendation moment: {PLACEMENT_LABELS[str(scenario['placement'])]}. "
            "Eligibility is applied before ranking."
        )
        if st.button("Generate recommendations", type="primary", use_container_width=True):
            st.session_state["demo_decision"] = None
            st.session_state["demo_stage"] = 2
            st.rerun()
        return

    st.markdown(_recommendation_html(slate, lookup), unsafe_allow_html=True)
    if stage == 2:
        st.caption(
            "The recommendation has been made. The next action belongs to the "
            "customer—not the simulator."
        )
        accept_column, decline_column = st.columns(2)
        if accept_column.button(
            "Add to order",
            type="primary",
            use_container_width=True,
            key="guided_accept",
        ):
            st.session_state["demo_decision"] = "accepted"
            st.session_state["demo_stage"] = 3
            st.rerun()
        if decline_column.button(
            "No thanks",
            use_container_width=True,
            key="guided_decline",
        ):
            st.session_state["demo_decision"] = "declined"
            st.session_state["demo_stage"] = 3
            st.rerun()
        with st.expander("Presenter controls", expanded=False):
            st.caption(
                "Auto-play uses the response stored in the synthetic journey. "
                "It is not a customer-facing action."
            )
            if st.button(
                "Auto-play recorded synthetic response",
                use_container_width=True,
                key="guided_autoplay",
            ):
                st.session_state["demo_decision"] = "recorded"
                st.session_state["demo_stage"] = 3
                st.rerun()
        return

    st.markdown(
        _response_html(
            str(st.session_state["demo_decision"] or "recorded"),
            request,
            outcome,
            slate,
            lookup,
        ),
        unsafe_allow_html=True,
    )
    if st.button("Start another demo", use_container_width=True):
        _reset_stage()
        st.rerun()


def _variant_theatre(data: dict[str, Any]) -> None:
    _header("Kiosk theatre")
    st.session_state.setdefault("demo_stage", 0)
    st.session_state.setdefault("demo_decision", None)
    journey_id, scenario = _scenario_picker("theatre")
    request, outcome, slate, lookup = _scenario_data(
        data, journey_id, str(scenario["placement"])
    )
    stage = int(st.session_state["demo_stage"])

    left, right = st.columns((0.78, 1.22), gap="large")
    with left:
        st.markdown(
            f"""
            <div class="receipt">
              <div class="eyebrow">Live order ticket</div>
              <h3>{_safe(request["basket_item_name"])}</h3>
              <div class="ticket-rule"></div>
              <div class="ticket-row"><span>Store</span><strong>{_safe(request["store_name"])}</strong></div>
              <div class="ticket-row"><span>Mission</span><strong>{_safe(str(request["mission"]).replace("_", " ").title())}</strong></div>
              <div class="ticket-row"><span>Party</span><strong>{_safe(request["party_size"])}</strong></div>
              <div class="ticket-row"><span>Budget</span><strong>{_money(request["budget_vnd"])}</strong></div>
              <div class="ticket-rule"></div>
              <div class="ticket-row"><span>Basket</span><strong>{_money(request["basket_subtotal_vnd"])}</strong></div>
              <div class="ticket-row"><span>Moment</span><strong>{_safe(PLACEMENT_LABELS[str(scenario["placement"])])}</strong></div>
            </div>
            """,
            unsafe_allow_html=True,
        )
        if st.button(
            "Recommend the next bite",
            type="primary",
            use_container_width=True,
        ):
            st.session_state["demo_decision"] = None
            st.session_state["demo_stage"] = 2
            st.rerun()
        if stage >= 2:
            accept_column, decline_column = st.columns(2)
            if accept_column.button(
                "Add to order",
                type="primary",
                use_container_width=True,
                key="theatre_accept",
            ):
                st.session_state["demo_decision"] = "accepted"
                st.session_state["demo_stage"] = 3
                st.rerun()
            if decline_column.button(
                "No thanks",
                use_container_width=True,
                key="theatre_decline",
            ):
                st.session_state["demo_decision"] = "declined"
                st.session_state["demo_stage"] = 3
                st.rerun()
            with st.expander("Presenter controls", expanded=False):
                if st.button(
                    "Auto-play recorded response",
                    use_container_width=True,
                    key="theatre_autoplay",
                ):
                    st.session_state["demo_decision"] = "recorded"
                    st.session_state["demo_stage"] = 3
                    st.rerun()

    with right:
        st.markdown('<div class="theatre-shell">', unsafe_allow_html=True)
        if stage < 2:
            st.markdown(
                """
                <div class="empty-stage">
                  <div>
                    <div class="eyebrow">Recommendation stage</div>
                    <h3>Ready when the basket is.</h3>
                    <p>Run the moment to reveal the primary suggestion and alternatives.</p>
                  </div>
                </div>
                """,
                unsafe_allow_html=True,
            )
        else:
            st.markdown(_recommendation_html(slate, lookup), unsafe_allow_html=True)
            if stage >= 3:
                st.markdown(
                    _response_html(
                        str(st.session_state["demo_decision"] or "recorded"),
                        request,
                        outcome,
                        slate,
                        lookup,
                    ),
                    unsafe_allow_html=True,
                )
        st.markdown("</div>", unsafe_allow_html=True)


def _variant_evidence(data: dict[str, Any], bundle_path: str) -> None:
    _header("Evidence board")
    journey_id, scenario = _scenario_picker("board")
    request, outcome, slate, lookup = _scenario_data(
        data, journey_id, str(scenario["placement"])
    )
    primary = lookup[slate[0]["candidate_id"]]
    selected_name = _selected_name(outcome, lookup)
    accepted = outcome["selected_candidate_id"] is not None

    st.markdown(
        f"""
        <div class="board-grid">
          <section class="board-stage">
            <div class="board-number">01</div>
            <div class="eyebrow">Context</div>
            <div class="board-title">{_safe(request["mission"]).replace("_", " ").title()}</div>
            <p><strong>{_safe(request["basket_item_name"])}</strong></p>
            <p>{_safe(request["party_size"])} people · {_money(request["budget_vnd"])}</p>
            <p>{_safe(request["store_name"])}</p>
          </section>
          <section class="board-stage decision">
            <div class="board-number">02</div>
            <div class="eyebrow" style="color:#f0b323">Decision</div>
            <div class="board-title">{_safe(primary["name"])}</div>
            <p><strong>+ {_money(primary["price_delta_vnd"])}</strong></p>
            <p>{_safe(POLICY_REASONS.get(str(slate[0]["logging_policy"]), "Eligible for this context"))}</p>
            <p>{len(slate) - 1} alternatives retained</p>
          </section>
          <section class="board-stage">
            <div class="board-number">03</div>
            <div class="eyebrow">Observed response</div>
            <div class="board-title">{_safe(selected_name)}</div>
            <p><strong>{"Accepted" if accepted else "Declined"}</strong></p>
            <p>Basket {_money(outcome["basket_subtotal_after_vnd"])}</p>
            <p>{"Checkout completed" if outcome["checked_out"] else "Checkout abandoned"}</p>
          </section>
        </div>
        """,
        unsafe_allow_html=True,
    )

    with st.expander("Inspect model-visible evidence", expanded=False):
        st.dataframe(
            [
                {
                    "rank": row["position"],
                    "candidate": lookup[row["candidate_id"]]["name"],
                    "price": lookup[row["candidate_id"]]["price_delta_vnd"],
                    "policy": row["logging_policy"],
                    "examination probability": row["examination_probability"],
                    "joint slate propensity": row["joint_slate_propensity"],
                }
                for row in slate
            ],
            hide_index=True,
            use_container_width=True,
        )
        eligible_rows = [
            row for row in lookup.values() if bool(row["eligible"])
        ]
        blocked_rows = [
            row for row in lookup.values() if not bool(row["eligible"])
        ]
        m1, m2, m3 = st.columns(3)
        m1.metric("Eligible candidates", len(eligible_rows))
        m2.metric("Blocked candidates", len(blocked_rows))
        m3.metric("Bundle audit", str(data["audit"]["status"]).upper())

    with st.expander("Reveal physically separate simulator oracle", expanded=False):
        st.error(
            "SIMULATED HIDDEN TRUTH — this table is evaluation evidence and is "
            "never available to ranking features."
        )
        oracle = [
            row
            for row in _load_oracle(bundle_path)
            if row["request_id"] == outcome["request_id"]
        ]
        st.dataframe(
            [
                {
                    "candidate": lookup[row["candidate_id"]]["name"],
                    "utility": row["total_utility"],
                    "response probability": row["base_response_probability"],
                    "taste match": row["taste_match"],
                    "basket affinity": row["basket_affinity"],
                    "price response": row["price_response"],
                }
                for row in sorted(
                    oracle, key=lambda value: -float(value["total_utility"])
                )
            ],
            hide_index=True,
            use_container_width=True,
        )


def _variant_switcher(current: str) -> None:
    keys = list(VARIANTS)
    index = keys.index(current)
    previous_key = keys[(index - 1) % len(keys)]
    next_key = keys[(index + 1) % len(keys)]
    st.markdown(
        f"""
        <nav class="prototype-switcher" aria-label="Prototype variants">
          <a href="?variant={previous_key}" title="Previous variant">←</a>
          <span class="current">{current} · {_safe(VARIANTS[current])}</span>
          <a href="?variant={next_key}" title="Next variant">→</a>
        </nav>
        """,
        unsafe_allow_html=True,
    )
    components.html(
        f"""
        <script>
        (() => {{
          const parentWindow = window.parent;
          if (parentWindow.__kfcPrototypeArrowHandler) {{
            parentWindow.removeEventListener(
              "keydown",
              parentWindow.__kfcPrototypeArrowHandler
            );
          }}
          parentWindow.__kfcPrototypeArrowHandler = (event) => {{
            const target = event.target;
            const tag = target && target.tagName ? target.tagName.toLowerCase() : "";
            if (["input", "textarea", "select"].includes(tag) || target?.isContentEditable) return;
            if (event.key === "ArrowLeft") parentWindow.location.search = "?variant={previous_key}";
            if (event.key === "ArrowRight") parentWindow.location.search = "?variant={next_key}";
          }};
          parentWindow.addEventListener("keydown", parentWindow.__kfcPrototypeArrowHandler);
        }})();
        </script>
        """,
        height=0,
    )


args = _arguments()
bundle = args.bundle.resolve()
data = _load_bundle(str(bundle))
variant = str(st.query_params.get("variant", "A")).upper()
if variant not in VARIANTS:
    variant = "A"

st.set_page_config(
    page_title=f"KFC recommendation demo · {VARIANTS[variant]}",
    page_icon="🍗",
    layout="wide",
    initial_sidebar_state="collapsed",
)
_inject_style()

if variant == "A":
    _variant_guided(data)
elif variant == "B":
    _variant_theatre(data)
else:
    _variant_evidence(data, str(bundle))

_variant_switcher(variant)
