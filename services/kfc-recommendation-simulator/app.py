from __future__ import annotations

import argparse
import json
from pathlib import Path

import pyarrow.parquet as pq
import streamlit as st


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument(
        "--bundle",
        type=Path,
        default=Path("../../.artifacts/kfc-recommendation-simulator/smoke"),
    )
    return parser.parse_known_args()[0]


def _rows(path: Path) -> list[dict[str, object]]:
    return pq.read_table(path).to_pylist()


args = _arguments()
bundle = args.bundle.resolve()
manifest = json.loads((bundle / "manifest.json").read_text(encoding="utf-8"))
audit = json.loads((bundle / "audit.json").read_text(encoding="utf-8"))
requests = _rows(bundle / "model-visible" / "requests.parquet")
candidates = _rows(bundle / "model-visible" / "candidates.parquet")
impressions = _rows(bundle / "model-visible" / "impressions.parquet")
outcomes = _rows(bundle / "model-visible" / "outcomes.parquet")

st.set_page_config(page_title="KFC recommendation world", layout="wide")
st.title("KFC recommendation behavioral world")
st.caption(
    "Throwaway simulator explorer · synthetic evidence, not production uplift"
)

mode = st.sidebar.radio("View", ("Executive", "Technical"))
journey_ids = [row["journey_id"] for row in requests]
journey_id = st.sidebar.selectbox("Ordering journey", journey_ids)
request = next(row for row in requests if row["journey_id"] == journey_id)
journey_outcomes = [row for row in outcomes if row["journey_id"] == journey_id]

summary_columns = st.columns(5)
summary_columns[0].metric("Store", request["store_name"])
summary_columns[1].metric("Mission", str(request["mission"]).replace("_", " "))
summary_columns[2].metric("Party", request["party_size"])
summary_columns[3].metric("Budget", f"{request['budget_vnd']:,}₫")
summary_columns[4].metric("Audit", audit["status"].upper())

st.subheader("Starting basket")
st.write(
    f"**{request['basket_item_name']}** · "
    f"{request['basket_subtotal_vnd']:,}₫ · {request['occurred_at']}"
)

placement = st.selectbox(
    "Recommendation placement",
    [row["placement"] for row in journey_outcomes],
)
outcome = next(
    row for row in journey_outcomes if row["placement"] == placement
)
slate = [
    row
    for row in impressions
    if row["journey_id"] == journey_id and row["placement"] == placement
]
request_id = outcome["request_id"]
candidate_lookup = {
    row["candidate_id"]: row
    for row in candidates
    if row["request_id"] == request_id
}

st.subheader("Displayed recommendation slate")
display_rows = [
    {
        "position": row["position"],
        "candidate": candidate_lookup[row["candidate_id"]]["name"],
        "price delta": candidate_lookup[row["candidate_id"]]["price_delta_vnd"],
        "logging policy": row["logging_policy"],
        "examination probability": row["examination_probability"],
        "joint slate propensity": row["joint_slate_propensity"],
    }
    for row in slate
]
st.dataframe(display_rows, use_container_width=True, hide_index=True)

selected = outcome["selected_candidate_id"]
selected_name = candidate_lookup[selected]["name"] if selected else "Nothing selected"
left, right = st.columns(2)
left.metric("Observed outcome", selected_name)
right.metric(
    "Basket after recommendation",
    f"{outcome['basket_subtotal_after_vnd']:,}₫",
    delta=f"{outcome['gross_incremental_value_vnd']:,}₫",
)
st.write(
    "Checkout:",
    "completed" if outcome["checked_out"] else "abandoned",
)

if mode == "Technical":
    st.divider()
    st.subheader("Eligibility evidence")
    st.dataframe(
        [
            {
                "candidate": row["name"],
                "eligible": row["eligible"],
                "reason": row["eligibility_reason"],
                "action": row["action_kind"],
                "modifier path": row["modifier_path"],
            }
            for row in candidate_lookup.values()
        ],
        use_container_width=True,
        hide_index=True,
    )
    if st.toggle("Reveal simulator oracle"):
        st.error(
            "SIMULATED HIDDEN TRUTH — physically separate and never available "
            "to ranking features"
        )
        oracle = [
            row
            for row in _rows(bundle / "oracle" / "counterfactuals.parquet")
            if row["request_id"] == request_id
        ]
        st.dataframe(
            [
                {
                    "candidate": candidate_lookup[row["candidate_id"]]["name"],
                    "utility": row["total_utility"],
                    "response probability": row["base_response_probability"],
                    "common random draw": row["common_random_draw"],
                    "taste match": row["taste_match"],
                    "basket affinity": row["basket_affinity"],
                    "price response": row["price_response"],
                }
                for row in sorted(
                    oracle, key=lambda value: -float(value["total_utility"])
                )
            ],
            use_container_width=True,
            hide_index=True,
        )
