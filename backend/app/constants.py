"""Small cross-router constants that need a single source of truth."""

# Loyalty point redemption rate: 100 points = AED 1. Used both when a
# cashier applies a points discount at checkout (routers/pos.py) and when
# computing the outstanding loyalty liability in the P&L (routers/analytics.py).
POINTS_TO_AED = 0.01
