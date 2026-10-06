"""The customer app (catalogue, shopping list, self-checkout, receipts, recommendations) and the register (customer
directory, cashier checkout, loyalty points, stock draw-down)."""
from datetime import timedelta

from app.clock import utcnow
from app.models import Batch, BatchStatus, Offer, Product, ShoppingListItem, Task, User
from tests.conftest import user_by_email


def sku(db, code) -> Product:
    return db.query(Product).filter(Product.sku == code).one()


def hq_stock(db, hq, code) -> int:
    db.expire_all()
    product = sku(db, code)
    return sum(b.quantity for b in db.query(Batch).filter(Batch.store_id == hq.id, Batch.product_id == product.id, Batch.status == BatchStatus.active))


class TestCatalogueAndOffers:
    def test_searches_by_name_category_and_barcode(self, api):
        assert [p["name"] for p in api.get("/customer/products?search=MILK", "customer").json()] == ["Whole Milk (2L)"]
        assert len(api.get("/customer/products?category=Frozen", "customer").json()) == 3
        assert api.get("/customer/products?barcode=8901000001025", "customer").json()[0]["name"] == "Greek Yogurt (500g)"
        assert api.get("/customer/products?search=zzz", "customer").json() == []

    def test_shows_active_offers_only(self, api, db):
        assert len(api.get("/customer/offers", "customer").json()) == 3
        offers = db.query(Offer).order_by(Offer.title).all()
        by_title = {o.title: o for o in offers}
        by_title["20% off fresh berries"].active = False
        by_title["Frozen bundle deal"].ends_at = utcnow() - timedelta(seconds=1)
        db.commit()
        assert [o["title"] for o in api.get("/customer/offers", "customer").json()] == ["Bakery: buy 1 get 1"]


class TestShoppingListAndSelfCheckout:
    def test_returns_the_list_newest_first_with_product_details(self, api):
        items = api.get("/customer/shopping-list", "customer").json()
        assert len(items) == 5
        assert items[0]["product"]["name"] and isinstance(items[0]["product"]["price"], float)
        assert len([i for i in items if i["checked"]]) == 2

    def test_merges_a_repeat_add_into_the_open_line_and_caps_quantity(self, api, db):
        eggs = sku(db, "SKU-1103")
        first = api.post("/customer/shopping-list", "customer", json={"product_id": eggs.id, "quantity": 2})
        assert first.status_code == 201
        assert first.json()["quantity"] == 3  # the unchecked eggs line already held 1
        assert api.post("/customer/shopping-list", "customer", json={"product_id": eggs.id, "quantity": 999}).json()["quantity"] == 999
        assert len(api.get("/customer/shopping-list", "customer").json()) == 5
        assert api.post("/customer/shopping-list", "customer", json={"product_id": "ghost"}).status_code == 404
        assert api.post("/customer/shopping-list", "customer", json={"product_id": eggs.id, "quantity": 0}).status_code == 422

    def test_edits_and_removes_only_the_customers_own_lines(self, api, db):
        item = next(i for i in api.get("/customer/shopping-list", "customer").json() if i["product"]["sku"] == "SKU-1002")
        edited = api.patch(f"/customer/shopping-list/{item['id']}", "customer", json={"quantity": 4, "checked": True}).json()
        assert (edited["quantity"], edited["checked"]) == (4, True)
        assert api.patch(f"/customer/shopping-list/{item['id']}", "customer", json={"quantity": 1000}).status_code == 422

        other = ShoppingListItem(customer_id=user_by_email(db, "omar.alsuwaidi@members.retailmind.app").id, product_id=item["product_id"], quantity=1)
        db.add(other)
        db.commit()
        assert api.patch(f"/customer/shopping-list/{other.id}", "customer", json={"checked": True}).status_code == 404
        assert api.delete(f"/customer/shopping-list/{other.id}", "customer").status_code == 404
        assert api.delete(f"/customer/shopping-list/{item['id']}", "customer").status_code == 204

    def test_turns_checked_lines_into_an_order_earns_points_and_draws_stock(self, api, db, hq):
        milk, bread = sku(db, "SKU-1101"), sku(db, "SKU-1301")
        before = {"milk": hq_stock(db, hq, "SKU-1101"), "bread": hq_stock(db, hq, "SKU-1301"), "points": user_by_email(db, "layla@members.retailmind.app").loyalty_points}
        res = api.post("/customer/checkout", "customer", json={"store_id": hq.id})
        assert res.status_code == 201
        body = res.json()
        assert body["channel"] == "self_checkout" and body["total"] == round(milk.price + bread.price, 2)
        assert body["loyalty_points_earned"] == int(milk.price + bread.price) and body["customer_name"] == "Layla Hassan" and len(body["items"]) == 2
        assert hq_stock(db, hq, "SKU-1101") == before["milk"] - 1
        assert hq_stock(db, hq, "SKU-1301") == before["bread"] - 1
        assert api.get("/auth/me", "customer").json()["loyalty_points"] == before["points"] + body["loyalty_points_earned"]
        assert all(not i["checked"] for i in api.get("/customer/shopping-list", "customer").json())

    def test_refuses_an_empty_checkout_and_an_unknown_store(self, api, hq):
        for item in api.get("/customer/shopping-list", "customer").json():
            api.patch(f"/customer/shopping-list/{item['id']}", "customer", json={"checked": False})
        empty = api.post("/customer/checkout", "customer", json={"store_id": hq.id})
        assert empty.status_code == 400 and "No checked items" in empty.json()["detail"]
        item = api.get("/customer/shopping-list", "customer").json()[0]
        api.patch(f"/customer/shopping-list/{item['id']}", "customer", json={"checked": True})
        ghost = api.post("/customer/checkout", "customer", json={"store_id": "ghost"})
        assert (ghost.status_code, ghost.json()) == (404, {"detail": "Store not found"})

    def test_records_a_stock_count_task_when_a_sale_outruns_recorded_stock(self, api, db, hq):
        bananas = sku(db, "SKU-1003")
        for batch in db.query(Batch).filter(Batch.product_id == bananas.id, Batch.store_id == hq.id):
            batch.quantity = 1
        db.commit()
        line = api.post("/customer/shopping-list", "customer", json={"product_id": bananas.id, "quantity": 3}).json()
        api.patch(f"/customer/shopping-list/{line['id']}", "customer", json={"checked": True})
        res = api.post("/customer/checkout", "customer", json={"store_id": hq.id})
        assert res.status_code == 201  # the sale still stands
        db.expire_all()
        task = db.query(Task).filter(Task.title == "Stock count: Ripe Bananas (kg)").one()
        assert task.source == "Stock count" and task.done is False and "Sold" in task.detail

    def test_builds_receipts_and_computed_recommendations(self, api):
        receipts = api.get("/customer/receipts", "customer").json()
        assert len(receipts) >= 1
        times = [r["created_at"] for r in receipts]
        assert times == sorted(times, reverse=True)
        recs = api.get("/customer/recommendations", "customer").json()
        assert len(recs) <= 6
        assert recs[0]["reason"].startswith("You've bought this ")
        ids = [r["product"]["id"] for r in recs]
        assert len(set(ids)) == len(ids)
        assert any("Popular in" in r["reason"] for r in recs)


class TestRegisterDirectory:
    def test_searches_by_name_phone_or_email_and_lists_recent_activity_first(self, api):
        everyone = api.get("/pos/customers", "staff").json()
        assert len(everyone) >= 5
        assert everyone[0]["member_since"].endswith("Z") and isinstance(everyone[0]["total_orders"], int)
        assert [c["name"] for c in api.get("/pos/customers?search=fatima", "staff").json()] == ["Fatima Al Zaabi"]
        assert [c["name"] for c in api.get("/pos/customers?search=2004", "staff").json()] == ["Rahul Menon"]
        assert len(api.get("/pos/customers?search=omar.al", "staff").json()) == 1
        assert api.get("/pos/customers?search=nobody", "staff").json() == []

    def test_opens_a_customer_with_their_order_history(self, api, db):
        fatima = db.query(User).filter(User.name == "Fatima Al Zaabi").one()
        body = api.get(f"/pos/customers/{fatima.id}", "staff").json()
        assert body["name"] == "Fatima Al Zaabi" and body["total_orders"] == 2 and len(body["orders"]) == 2
        assert body["orders"][0]["channel"] == "cashier" and body["orders"][0]["cashier_name"] and isinstance(body["orders"][0]["items"], list)
        assert api.get("/pos/customers/ghost", "staff").status_code == 404
        assert api.get(f"/pos/customers/{user_by_email(db, 'marcus@retailmind.app').id}", "staff").status_code == 404

    def test_enrols_at_the_till_and_returns_the_existing_member_for_a_known_number(self, api):
        created = api.post("/pos/customers", "staff", json={"name": "  Walk In  ", "phone": " +971-55-400-4001 ", "email": ""})
        assert created.status_code == 201
        body = created.json()
        assert (body["name"], body["phone"], body["loyalty_points"], body["total_orders"], body["orders"]) == ("Walk In", "+971-55-400-4001", 0, 0, [])
        assert body["email"] == "cust971554004001@members.retailmind.app"
        again = api.post("/pos/customers", "staff", json={"name": "Someone Else", "phone": "+971-55-400-4001"}).json()
        assert again["id"] == body["id"] and again["name"] == "Walk In"
        staff_number = api.post("/pos/customers", "staff", json={"name": "Imposter", "phone": "+971-50-100-1001"})
        assert (staff_number.status_code, staff_number.json()) == (409, {"detail": "This number belongs to a staff account, not a customer"})
        assert api.post("/pos/customers", "staff", json={"name": "Dup", "phone": "+971-55-400-4999", "email": "layla@members.retailmind.app"}).status_code == 409
        assert api.post("/pos/customers", "staff", json={"name": "", "phone": "+971-1"}).status_code == 422
        assert api.post("/pos/customers", "staff", json={"name": "Ok", "phone": "12"}).status_code == 422


class TestCashierCheckout:
    @staticmethod
    def sale(db, hq, **over):
        return {"store_id": hq.id, "items": [{"product_id": sku(db, "SKU-1001").id, "quantity": 2}], "payment_method": "card"} | over

    def test_rings_up_a_walk_in_card_sale_and_draws_stock_down(self, api, db, hq):
        before = hq_stock(db, hq, "SKU-1001")
        res = api.post("/pos/checkout", "staff", json=self.sale(db, hq))
        assert res.status_code == 201
        body = res.json()
        assert (body["total"], body["channel"], body["payment_method"], body["customer_name"], body["loyalty_points_earned"], body["change_due"], body["cashier_name"]) == (17.8, "cashier", "card", "Guest", 0, 0, "Diego Ramirez")
        assert hq_stock(db, hq, "SKU-1001") == before - 2

    def test_handles_cash_with_change_and_refuses_short_tender(self, api, db, hq):
        short = api.post("/pos/checkout", "staff", json=self.sale(db, hq, payment_method="cash", amount_tendered=10))
        assert (short.status_code, short.json()) == (422, {"detail": "Amount tendered is less than the total due"})
        assert api.post("/pos/checkout", "staff", json=self.sale(db, hq, payment_method="cash")).status_code == 422
        ok = api.post("/pos/checkout", "staff", json=self.sale(db, hq, payment_method="cash", amount_tendered=20)).json()
        assert (ok["total"], ok["amount_tendered"], ok["change_due"]) == (17.8, 20, 2.2)

    def test_awards_and_redeems_loyalty_points_on_the_members_account(self, api, db, hq):
        omar = db.query(User).filter(User.name == "Omar Al Suwaidi").one()
        start = omar.loyalty_points
        res = api.post("/pos/checkout", "staff", json=self.sale(db, hq, customer_id=omar.id, points_to_redeem=500, payment_method="apple_pay"))
        assert res.status_code == 201
        body = res.json()
        assert (body["points_redeemed"], body["total"], body["customer_name"], body["loyalty_points_earned"]) == (500, 12.8, "Omar Al Suwaidi", 12)  # 17.80 - AED 5.00
        db.expire_all()
        assert db.get(User, omar.id).loyalty_points == start - 500 + 12

    def test_caps_redemption_at_the_basket_value_and_validates_the_rules(self, api, db, hq):
        fatima = db.query(User).filter(User.name == "Fatima Al Zaabi").one()
        capped = api.post("/pos/checkout", "staff", json=self.sale(db, hq, customer_id=fatima.id, points_to_redeem=2000, payment_method="tabby")).json()
        assert (capped["points_redeemed"], capped["total"]) == (1780, 0)
        attach = api.post("/pos/checkout", "staff", json=self.sale(db, hq, points_to_redeem=100))
        assert (attach.status_code, attach.json()) == (422, {"detail": "Attach a customer to redeem loyalty points"})
        rahul = db.query(User).filter(User.name == "Rahul Menon").one()
        over = api.post("/pos/checkout", "staff", json=self.sale(db, hq, customer_id=rahul.id, points_to_redeem=99999)).json()
        assert over["detail"] == f"Rahul Menon only has {rahul.loyalty_points} points available"

    def test_validates_the_cart(self, api, db, hq):
        post = lambda **over: api.post("/pos/checkout", "staff", json=self.sale(db, hq, **over))  # noqa: E731
        assert post(payment_method="bitcoin").json()["detail"] == "payment_method must be one of cash, card, apple_pay, google_pay, samsung_pay, tabby"
        assert post(items=[]).json()["detail"] == "Cart is empty"
        assert post(store_id="ghost").json()["detail"] == "Store not found"
        assert post(items=[{"product_id": "ghost", "quantity": 1}]).json()["detail"] == "Product ghost not found"
        assert post(customer_id="ghost").json()["detail"] == "Customer not found"
        assert post(items=[{"product_id": sku(db, "SKU-1001").id, "quantity": 0}]).status_code == 422
        assert api.post("/pos/checkout", "customer", json=self.sale(db, hq)).status_code == 403

    def test_feeds_the_sale_into_analytics(self, api, db, hq):
        for _ in range(4):
            api.post("/pos/checkout", "staff", json=self.sale(db, hq))
        movers = api.get(f"/analytics/movers?store_id={hq.id}", "staff").json()
        assert movers
        apples = next(m for m in movers if m["product_name"] == "Gala Apples (kg)")
        assert apples["units_sold_recent"] >= 8 and apples["days_of_supply"] > 0
        sold = [m["units_sold_recent"] for m in movers]
        assert sold == sorted(sold, reverse=True)
