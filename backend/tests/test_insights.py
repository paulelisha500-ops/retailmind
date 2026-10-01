"""Analytics, profit and loss, the warehouse views and the business assistant."""
import re
from datetime import datetime, timedelta

from app.models import Alert, AlertStatus, Batch, BatchStatus, Product, Store, Transaction


def sku(db, code) -> Product:
    return db.query(Product).filter(Product.sku == code).one()


def store_named(db, name) -> Store:
    return db.query(Store).filter(Store.name == name).one()


def revenue_of(summary) -> int:
    return int(re.sub(r"\D", "", summary["kpis"][0]["value"]))


class TestAnalyticsSummary:
    def test_rolls_up_seven_full_days_with_formatted_kpis(self, api):
        res = api.get("/analytics/summary", "admin")
        assert res.status_code == 200
        body = res.json()
        assert [k["label"] for k in body["kpis"]] == ["Revenue (7d)", "Units sold (7d)", "Avg daily revenue", "Promo-driven units"]
        assert re.fullmatch(r"AED [\d,]+", body["kpis"][0]["value"])
        assert len(body["sales_trend"]) == 7
        assert len(body["category_revenue_mix"]) == 5
        assert 99 < sum(c["value"] for c in body["category_revenue_mix"]) < 101
        assert sorted(s["name"] for s in body["store_comparison"]) == ["Airport Plaza", "Downtown Central", "North Hills", "Riverside Mall"]
        # The flagship outsells the smaller formats.
        revenue = {s["name"]: s["revenue"] for s in body["store_comparison"]}
        assert revenue["Downtown Central"] > revenue["Riverside Mall"] > revenue["North Hills"]

    def test_is_for_admins_only(self, api):
        assert api.get("/analytics/summary", "manager").status_code == 403
        assert api.get("/analytics/summary", "customer").status_code == 403
        assert api.get("/analytics/summary").status_code == 401

    def test_scopes_to_one_store_and_drops_the_cross_store_comparison(self, api, hq):
        everything = api.get("/analytics/summary", "admin").json()
        one = api.get(f"/analytics/summary?store_id={hq.id}", "admin").json()
        assert one["store_comparison"] == []
        assert revenue_of(one) < revenue_of(everything)
        flagship = next(s for s in everything["store_comparison"] if s["name"] == "Downtown Central")["revenue"]
        assert abs(revenue_of(one) - flagship) < 1

    def test_reports_waste_per_category_with_no_data_as_null_rather_than_zero(self, api, db, hq):
        body = api.get(f"/analytics/summary?store_id={hq.id}", "admin").json()
        assert next(w for w in body["waste_by_category"] if w["name"] == "Bakery")["pct"] > 0  # the written-off croissant lot
        assert next(w for w in body["waste_by_category"] if w["name"] == "Produce")["pct"] == 0
        for batch in db.query(Batch).join(Product, Product.id == Batch.product_id).filter(Batch.store_id == hq.id, Product.category == "Frozen"):
            db.delete(batch)
        db.commit()
        after = api.get(f"/analytics/summary?store_id={hq.id}", "admin").json()
        assert next(w for w in after["waste_by_category"] if w["name"] == "Frozen")["pct"] is None


class TestMovers:
    def test_validates_the_window_and_the_limit(self, api, hq):
        assert api.get(f"/analytics/movers?store_id={hq.id}&days=0", "staff").status_code == 422
        assert api.get(f"/analytics/movers?store_id={hq.id}&limit=0", "staff").status_code == 422
        assert api.get("/analytics/movers", "staff").status_code == 422
        assert api.get(f"/analytics/movers?store_id={hq.id}", "customer").status_code == 403

    def test_ranks_by_units_sold_with_days_of_supply(self, api, db, hq):
        movers = api.get(f"/analytics/movers?store_id={hq.id}&days=30", "staff").json()
        assert movers
        sold = [m["units_sold_recent"] for m in movers]
        assert sold == sorted(sold, reverse=True)
        assert api.get(f"/analytics/movers?store_id={hq.id}&days=30&limit=1", "staff").json() == movers[:1]
        assert all(m["days_of_supply"] is None or m["days_of_supply"] >= 0 for m in movers)


class TestProfitAndLoss:
    def test_adds_up_net_is_gross_less_discounts_and_profit_is_net_less_cogs(self, api):
        pnl = api.get("/analytics/pnl?days=30", "admin").json()
        assert pnl["period_days"] == 30 and pnl["orders"] == 7
        assert abs(pnl["net_sales"] - (pnl["gross_sales"] - pnl["discounts"])) < 0.01
        assert abs(pnl["gross_profit"] - (pnl["net_sales"] - pnl["cogs"])) < 0.01
        assert abs(pnl["margin_pct"] - pnl["gross_profit"] / pnl["net_sales"] * 100) < 0.5
        assert abs(pnl["avg_order_value"] - pnl["net_sales"] / pnl["orders"]) < 0.05
        assert abs(sum(c["revenue"] for c in pnl["by_category"]) - pnl["gross_sales"]) < 0.1
        assert len(pnl["by_store"]) == 4
        store_revenue = [s["revenue"] for s in pnl["by_store"]]
        assert store_revenue == sorted(store_revenue, reverse=True)
        assert re.fullmatch(r"[A-Z][a-z]{2} \d{2}", pnl["trend"][0]["label"])
        assert pnl["products_missing_cost"] == 0
        assert pnl["shrinkage_units"] == 18  # the written-off croissant lot
        assert pnl["loyalty_liability"] > 0

    def test_scopes_to_a_store_windows_by_days_and_flags_products_with_no_cost(self, api, db, hq):
        one = api.get(f"/analytics/pnl?store_id={hq.id}&days=30", "admin").json()
        assert one["by_store"] == [] and one["orders"] < 7
        assert api.get("/analytics/pnl?days=2", "admin").json()["orders"] < 7
        sku(db, "SKU-1201").cost_price = None
        db.commit()
        assert api.get("/analytics/pnl?days=30", "admin").json()["products_missing_cost"] > 0
        assert api.get("/analytics/pnl?days=0", "admin").status_code == 422
        assert api.get("/analytics/pnl", "manager").status_code == 403

    def test_a_new_sale_moves_the_figures_by_exactly_its_value(self, api, db, hq):
        before = api.get("/analytics/pnl?days=30", "admin").json()
        milk = sku(db, "SKU-1101")
        sale = api.post("/pos/checkout", "staff", json={"store_id": hq.id, "items": [{"product_id": milk.id, "quantity": 3}], "payment_method": "card"})
        assert sale.status_code == 201
        after = api.get("/analytics/pnl?days=30", "admin").json()
        assert after["orders"] == before["orders"] + 1
        assert abs(after["gross_sales"] - before["gross_sales"] - round(milk.price * 3, 2)) < 0.01
        assert abs(after["cogs"] - before["cogs"] - round(milk.cost_price * 3, 2)) < 0.01


class TestWarehouse:
    def test_computes_zone_utilisation_from_stock_and_staging_from_inbound_orders(self, api, db, hq):
        zones = api.get(f"/warehouse/zones?store_id={hq.id}", "staff").json()
        assert [z["name"] for z in zones] == ["Zone A · Dry Goods & Produce", "Zone B · Cold Storage", "Zone C · Frozen", "Zone D · Receiving & Staging"]
        on_hand = sum(
            b.quantity for b in db.query(Batch).join(Product, Product.id == Batch.product_id)
            .filter(Batch.store_id == hq.id, Batch.status == BatchStatus.active, Product.category == "Frozen")
        )
        frozen = zones[2]
        assert frozen["current_units"] == on_hand
        assert abs(frozen["pct"] - min(100, on_hand / frozen["capacity_units"] * 100)) < 0.1
        assert zones[3]["current_units"] == 340  # PO-1042 is inbound

    def test_orders_the_pick_route_by_aisle_and_skips_expiries_an_alert_already_covers(self, api, db, hq):
        batch = db.query(Batch).filter(Batch.store_id == hq.id, Batch.status == BatchStatus.active, Batch.aisle_location.like("Aisle 14%")).first()
        batch.expires_at = datetime.utcnow() + timedelta(days=1)
        db.commit()
        route = api.get(f"/warehouse/pick-route?store_id={hq.id}", "staff").json()
        assert [r["step"] for r in route] == list(range(1, len(route) + 1))
        aisles = [int(re.search(r"\d+", r["location"]).group()) for r in route]
        assert aisles == sorted(aisles)
        expiring = next(r for r in route if r["source"] == "FEFO expiry")
        assert re.fullmatch(r"Rotate/markdown .+ — \d+d left \(LOT-\d+\)", expiring["task"])
        assert any(r["source"] == "Shelf/quality alert" for r in route)
        assert all("Concealment" not in r["task"] for r in route)  # theft alerts aren't a stocking task

    def test_normalises_floor_traffic_against_the_stores_own_busiest_hour(self, api, hq):
        curve = api.get(f"/warehouse/congestion?store_id={hq.id}", "staff").json()
        assert max(c["level"] for c in curve) == 100
        labels = [c["hour"] for c in curve]
        assert labels[0] == "6a" and "12p" in labels and labels[-1] == "10p"
        assert next(c for c in curve if c["hour"] == "12p")["transaction_count"] > 5

    def test_scales_saturday_staffing_from_the_real_weekday_ratio(self, api, db, hq):
        plan = api.get(f"/warehouse/staffing?store_id={hq.id}", "staff").json()
        assert plan["day"] == "Saturday" and plan["baseline_staff"] == 4 and plan["recommended_staff"] >= 4
        assert re.fullmatch(r"Saturday averages \d+ transactions/day vs \d+ on weekdays \(\+\d+%\) over the recorded history — scaled from a baseline crew of 4\.", plan["reason"])
        empty = store_named(db, "Riverside Mall")
        db.query(Transaction).filter(Transaction.store_id == empty.id).delete()
        db.commit()
        assert "No transaction history" in api.get(f"/warehouse/staffing?store_id={empty.id}", "staff").json()["reason"]
        assert api.get(f"/warehouse/congestion?store_id={empty.id}", "staff").json() == []

    def test_every_view_needs_a_store_and_a_staff_login(self, api, hq):
        for view in ("zones", "pick-route", "congestion", "staffing"):
            assert api.get(f"/warehouse/{view}", "staff").status_code == 422
            assert api.get(f"/warehouse/{view}?store_id={hq.id}", "customer").status_code == 403


class TestAssistant:
    @staticmethod
    def ask(api, hq, question):
        return api.post("/assistant/ask", "staff", json={"question": question, "store_id": hq.id}).json()

    def test_routes_each_question_to_the_right_agent(self, api, hq):
        ask = lambda q: self.ask(api, hq, q)  # noqa: E731
        assert ask("Which products need attention this week?")["agent"] == "Quality Agent"
        assert ask("Which supplier performs best?")["agent"] == "Procurement Agent"
        assert ask("Is dairy demand actually decreasing?")["agent"] == "Forecast Agent"
        assert ask("Any security concerns today?")["agent"] == "Loss Prevention Agent"
        assert ask("What should I restock first?")["agent"] == "Inventory Agent"
        fallback = ask("hello there")
        assert (fallback["agent"], fallback["tone"]) == ("RetailMind Assistant", "neutral")

    def test_answers_from_real_data(self, api, hq):
        ask = lambda q: self.ask(api, hq, q)  # noqa: E731
        supplier = ask("best supplier")
        assert "Polar Cold Logistics leads at a 96 score" in supplier["text"]
        assert "Golden Wheat Bakers is the weak link" in supplier["text"]
        security = ask("any theft?")
        assert security["tone"] == "red" and "Checkout Zone · Lane 3" in security["text"]
        assert re.match(r"^Bakery is trending (up|down) about \d+% this week vs last week", ask("How is bakery demand?")["text"])
        assert "Dairy & Chilled" in ask("dairy sales")["text"]
        assert ask("overall demand")["text"].startswith("Overall demand")

    def test_reflects_changes_in_the_underlying_data(self, api, db, hq):
        for alert in db.query(Alert).all():
            alert.status = AlertStatus.resolved
        db.commit()
        assert self.ask(api, hq, "security") == {"agent": "Loss Prevention Agent", "tone": "green", "text": "No open security flags right now."}
        assert self.ask(api, hq, "expiring quality")["agent"] == "Quality Agent"

    def test_needs_a_question_a_store_and_a_staff_login(self, api, hq):
        assert api.post("/assistant/ask", "staff", json={"question": "x"}).status_code == 422
        assert api.post("/assistant/ask", "customer", json={"question": "x", "store_id": hq.id}).status_code == 403
        assert api.post("/assistant/ask", json={"question": "x", "store_id": hq.id}).status_code == 401
