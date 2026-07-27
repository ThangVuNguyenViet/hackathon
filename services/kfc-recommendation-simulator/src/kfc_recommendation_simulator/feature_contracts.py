"""Dependency-free feature contracts shared by training and serving."""

CATEGORICAL_FEATURES = (
    "candidate_id",
    "category",
    "product_code",
    "feature_cart_anchor",
    "feature_store_id",
    "feature_mission",
    "feature_time_window",
)
NUMERIC_FEATURES = (
    "feature_price_delta_vnd",
    "feature_discount_vnd",
    "feature_discount_ratio",
    "feature_basket_association_score",
    "feature_party_size",
    "feature_budget_vnd",
    "feature_cart_subtotal_vnd",
    "feature_customer_order_count",
    "feature_customer_item_order_count",
    "feature_customer_category_order_count",
    "feature_store_item_order_count",
    "feature_global_item_order_count",
    "feature_store_local_hour",
    "feature_store_local_day_of_week",
)
MODIFIER_CATEGORICAL_FEATURES = (
    "candidate_id",
    "product_code",
    "modifier_path",
    "feature_cart_anchor",
    "feature_store_id",
    "feature_mission",
    "feature_time_window",
)
MODIFIER_NUMERIC_FEATURES = (
    "feature_remaining_budget_vnd",
    "feature_price_to_remaining_budget_ratio",
)
