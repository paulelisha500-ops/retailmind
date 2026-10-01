"""Products, CSV import, stock views, suppliers, reorder detection, outreach and purchase-order approval."""
from datetime import datetime, timedelta

from app.models import Batch, BatchStatus, Product, Store, Supplier, SupplierContactLog
from tests.conftest import user_by_email


def csv_file(name: str, text: str):
    return {"file": (name, text.encode("utf-8"), "text/csv")}


def product(**over):
    return {"sku": "SKU-9001", "name": "Olive Oil (1L)", "category": "Pantry", "price": 29.5, "cost_price": 21, "reorder_threshold": 20} | over


def sku(db, code) -> Product:
    return db.query(Product).filter(Product.sku == code).one()


def supplier_named(db, name) -> Supplier:
    return db.query(Supplier).filter(Supplier.name == name).one()


class TestProducts:
    def test_lists_alphabetically_and_filters_by_category(self, api):
        names = [p["name"] for p in api.get("/inventory/products", "manager").json()]
        assert len(names) == 15 and names == sorted(names)
        bakery = api.get("/inventory/products?category=Bakery", "manager").json()
        assert len(bakery) == 3
        assert isinstance(bakery[0]["nutrition"], dict) and isinstance(bakery[0]["allergens"], list) and isinstance(bakery[0]["dietary_tags"], list)

    def test_creates_rejects_duplicates_and_validates(self, api):
        created = api.post("/inventory/products", "manager", json=product())
        assert created.status_code == 201
        body = created.json()
        assert body["sku"] == "SKU-9001" and body["unit"] == "each" and body["allergens"] == [] and body["nutrition"] == {} and body["supplier_id"] is None

        dup = api.post("/inventory/products", "manager", json=product())
        assert (dup.status_code, dup.json()) == (409, {"detail": "SKU SKU-9001 already exists"})
        bad = api.post("/inventory/products", "manager", json=product(sku="SKU-9002", price=0))
        assert bad.status_code == 422
        assert bad.json()["detail"][0]["loc"] == ["body", "price"] and bad.json()["detail"][0]["msg"] == "Input should be greater than 0"
        assert api.post("/inventory/products", "manager", json=product(sku="SKU-9003", price=2_000_000)).status_code == 422
        ghost = api.post("/inventory/products", "manager", json=product(sku="SKU-9004", supplier_id="ghost"))
        assert (ghost.status_code, ghost.json()) == (404, {"detail": "Supplier not found"})
        taken = api.post("/inventory/products", "manager", json=product(sku="SKU-9005", barcode="8901000000011"))
        assert (taken.status_code, taken.json()) == (409, {"detail": "Barcode 8901000000011 is already assigned to another product"})

    def test_updates_only_what_was_sent_and_lets_cost_and_supplier_be_cleared(self, api, db):
        created = api.post("/inventory/products", "manager", json=product()).json()
        supplier = db.query(Supplier).first()
        renamed = api.patch(f"/inventory/products/{created['id']}", "manager", json={"name": "Extra Virgin Olive Oil", "supplier_id": supplier.id}).json()
        assert renamed["name"] == "Extra Virgin Olive Oil" and renamed["price"] == 29.5 and renamed["cost_price"] == 21 and renamed["supplier_id"] == supplier.id
        cleared = api.patch(f"/inventory/products/{created['id']}", "manager", json={"cost_price": None, "supplier_id": None, "name": None}).json()
        assert cleared["cost_price"] is None and cleared["supplier_id"] is None and cleared["name"] == "Extra Virgin Olive Oil"
        assert api.patch(f"/inventory/products/{created['id']}", "manager", json={"price": -1}).status_code == 422
        assert api.patch("/inventory/products/nope", "manager", json={"name": "x"}).status_code == 404
        assert api.patch(f"/inventory/products/{created['id']}", "manager", json={"supplier_id": "ghost"}).json() == {"detail": "Supplier not found"}

    def test_refuses_to_delete_a_product_stock_or_orders_reference_and_deletes_a_clean_one(self, api, db):
        milk = sku(db, "SKU-1101")
        res = api.delete(f"/inventory/products/{milk.id}", "manager")
        assert res.status_code == 409 and "Can't delete" in res.json()["detail"]
        created = api.post("/inventory/products", "manager", json=product()).json()
        assert api.delete(f"/inventory/products/{created['id']}", "manager").status_code == 204
        assert api.delete(f"/inventory/products/{created['id']}", "manager").status_code == 404

    def test_a_product_on_a_shopping_list_is_not_deletable_either(self, api):
        created = api.post("/inventory/products", "manager", json=product()).json()
        api.post("/customer/shopping-list", "customer", json={"product_id": created["id"]})
        assert api.delete(f"/inventory/products/{created['id']}", "manager").status_code == 409


class TestProductImport:
    header = "sku,name,category,price,cost_price,reorder_threshold,supplier_name,allergens,dietary_tags,kcal,barcode"

    def test_creates_and_updates_rows_and_reports_every_problem_row(self, api, db):
        csv = "\r\n".join([
            self.header,
            'SKU-7001,"Sesame Bagels, 6 pack",Bakery,11.5,6.2,40,golden wheat bakers,gluten; sesame,Vegan;,250,8900000007001',
            "SKU-1001,Gala Apples (kg),Produce,9.25,6.4,55,fresh farms co.,,,52,",
            "SKU-7002,No Price,Bakery,,,,,,,,",
            "SKU-7003,Too Cheap,Bakery,0,,,,,,,",
            "SKU-7004,Bad Cost,Bakery,5,-1,,,,,,",
            ",No Sku,Bakery,5,,,,,,,",
            "SKU-7005,,Bakery,5,,,,,,,",
        ])
        res = api.post("/inventory/products/import", "manager", files=csv_file("products.CSV", csv))
        assert res.status_code == 200
        body = res.json()
        assert body["created"] == 1 and body["updated"] == 1
        assert body["errors"] == [
            "Row 4: invalid or missing price, skipped",
            "Row 5: price must be between 0 and 1,000,000, skipped",
            "Row 6: cost_price must be between 0 and 1,000,000, skipped",
            "Row 7: missing sku, skipped",
            "Row 8: name and category are required, skipped",
        ]
        db.expire_all()
        bagel = sku(db, "SKU-7001")
        assert (bagel.name, bagel.price, bagel.cost_price, bagel.reorder_threshold) == ("Sesame Bagels, 6 pack", 11.5, 6.2, 40)
        assert bagel.allergens == ["gluten", "sesame"] and bagel.dietary_tags == ["Vegan"] and bagel.nutrition == {"kcal": 250.0} and bagel.barcode == "8900000007001"
        assert bagel.supplier_id == supplier_named(db, "Golden Wheat Bakers").id
        assert sku(db, "SKU-1001").price == 9.25

    def test_a_barcode_that_belongs_to_another_product_skips_that_row_not_the_whole_import(self, api, db):
        csv = "\n".join([
            self.header,
            "SKU-7101,Rye Loaf,Bakery,12,7,20,,,,,8900000007101",  # row 2: created
            "SKU-7102,Seeded Loaf,Bakery,13,8,20,,,,,8900000007101",  # row 3: the code of the row above
            "SKU-7103,Spelt Loaf,Bakery,14,9,20,,,,,8901000001025",  # row 4: Greek Yogurt's code
            "SKU-7101,Rye Loaf,Bakery,12.5,7,20,,,,,8900000007101",  # row 5: a product keeps its own code
            "SKU-7104,Oat Loaf,Bakery,11,6,20,,,,,8900000007104",  # row 6: created
            "SKU-7104,Oat Loaf,Bakery,11,6,20,,,,,8901000001025",  # row 7: an existing product cannot take another one's code
        ])
        body = api.post("/inventory/products/import", "manager", files=csv_file("p.csv", csv)).json()
        assert (body["created"], body["updated"]) == (2, 1)
        assert body["errors"] == [
            "Row 3: barcode 8900000007101 is already assigned to another product, skipped",
            "Row 4: barcode 8901000001025 is already assigned to another product, skipped",
            "Row 7: barcode 8901000001025 is already assigned to another product, skipped",
        ]
        db.expire_all()
        assert (sku(db, "SKU-7101").price, sku(db, "SKU-7101").barcode) == (12.5, "8900000007101")
        assert sku(db, "SKU-7104").barcode == "8900000007104"
        assert db.query(Product).filter(Product.sku.in_(["SKU-7102", "SKU-7103"])).count() == 0

    def test_a_short_reimport_leaves_the_columns_it_does_not_have_alone(self, api, db):
        send = lambda name, text: api.post("/inventory/products/import", "manager", files=csv_file(name, text)).json()  # noqa: E731
        send("full.csv", f"{self.header}\nSKU-7201,Date Loaf,Bakery,9,5,30,golden wheat bakers,gluten,Vegan,210,8900000007201")
        db.expire_all()
        before = sku(db, "SKU-7201")
        kept = (before.cost_price, before.reorder_threshold, before.barcode, before.supplier_id, list(before.allergens), list(before.dietary_tags), dict(before.nutrition))
        assert kept[:3] == (5, 30, "8900000007201") and kept[3] and kept[4] == ["gluten"] and kept[6] == {"kcal": 210.0}

        res = send("short.csv", "sku,name,category,price\nSKU-7201,Date Loaf,Bakery,9.5")
        assert (res["created"], res["updated"], res["errors"]) == (0, 1, [])
        db.expire_all()
        after = sku(db, "SKU-7201")
        assert after.price == 9.5
        assert (after.cost_price, after.reorder_threshold, after.barcode, after.supplier_id, list(after.allergens), list(after.dietary_tags), dict(after.nutrition)) == kept

    def test_a_blank_cell_in_a_column_that_is_present_clears_that_field(self, api, db):
        send = lambda name, text: api.post("/inventory/products/import", "manager", files=csv_file(name, text)).json()  # noqa: E731
        send("full.csv", "sku,name,category,price,cost_price,supplier_name,allergens,kcal,carbs_g,barcode\nSKU-7202,Fig Loaf,Bakery,9,5,golden wheat bakers,gluten,210,40,8900000007202")
        db.expire_all()
        assert sku(db, "SKU-7202").nutrition == {"kcal": 210.0, "carbs_g": 40.0}

        assert send("clear.csv", "sku,name,category,price,cost_price,supplier_name,kcal,allergens\nSKU-7202,Fig Loaf,Bakery,9,,,,")["updated"] == 1
        db.expire_all()
        after = sku(db, "SKU-7202")
        assert (after.cost_price, after.supplier_id, after.allergens) == (None, None, [])
        assert after.nutrition == {"carbs_g": 40.0}  # the kcal column was in the file, carbs_g was not
        assert after.barcode == "8900000007202"

    def test_rejects_non_csv_files_empty_files_and_missing_columns(self, api):
        send = lambda name, text, who="manager": api.post("/inventory/products/import", who, files=csv_file(name, text))  # noqa: E731
        assert ".csv" in send("products.xlsx", "x").json()["detail"]
        assert send("a.csv", "").json()["detail"] == "Empty file"
        assert send("a.csv", "sku,name\nA,B").json()["detail"] == "CSV is missing required column(s): category, price"
        assert api.post("/inventory/products/import", "manager").status_code == 422
        assert send("a.csv", self.header, "staff").status_code == 403


class TestStockViews:
    def test_computes_shelf_fill_per_aisle_from_live_batch_quantities(self, api, db, hq):
        rows = api.get(f"/inventory/shelf-fill?store_id={hq.id}", "manager").json()
        locations = [r["location"] for r in rows]
        assert locations == sorted(locations)
        produce = next(r for r in rows if r["location"] == "Aisle 02")
        lots = [b for b in db.query(Batch).filter(Batch.store_id == hq.id, Batch.status == BatchStatus.active) if b.aisle_location.startswith("Aisle 02")]
        on_hand = sum(b.quantity for b in lots)
        capacity = sum(db.get(Product, b.product_id).reorder_threshold * 6 for b in lots)  # "full shelf" = 6x the reorder point
        assert produce["category"] == "Produce"
        assert produce["pct"] == round(min(100, on_hand / capacity * 100))

    def test_lists_batches_expiring_soon_oldest_expiry_first(self, api, db, hq):
        batch = db.query(Batch).filter(Batch.store_id == hq.id, Batch.status == BatchStatus.active).first()
        batch.expires_at = datetime.utcnow() + timedelta(days=1)
        db.commit()
        res = api.get(f"/inventory/expiring-soon?store_id={hq.id}&within_days=2", "manager").json()
        assert batch.id in [b["id"] for b in res]
        times = [b["expires_at"] for b in res]
        assert times == sorted(times)
        assert api.get(f"/inventory/expiring-soon?store_id={hq.id}&within_days=abc", "manager").status_code == 422


def supplier_body(**over):
    return {"name": "Harvest Hub", "category": "Produce", "contact_email": "", "contact_phone": "", "payment_terms": "Net 30", "cold_chain": "ambient", "onboarding_status": "pending"} | over


class TestSuppliers:
    def test_sorts_by_performance_score_and_exposes_onboarding_fields(self, api):
        rows = api.get("/procurement/suppliers", "staff").json()
        scores = [s["performance_score"] for s in rows]
        assert scores == sorted(scores, reverse=True)
        assert rows[0]["trade_license_no"] and rows[0]["trn"] and rows[0]["cold_chain"] and rows[0]["onboarding_status"] == "approved"

    def test_creates_with_defaults_treats_a_blank_email_as_unset_and_validates(self, api):
        res = api.post("/procurement/suppliers", "staff", json=supplier_body())
        assert res.status_code == 201
        body = res.json()
        assert (body["name"], body["contact_email"], body["performance_score"], body["on_time_pct"], body["late_deliveries_30d"], body["contract_end"]) == ("Harvest Hub", None, 80, 90, 0, None)
        bad = api.post("/procurement/suppliers", "staff", json=supplier_body(contact_email="nope"))
        assert bad.status_code == 422
        assert api.post("/procurement/suppliers", "staff", json=supplier_body(onboarding_status="maybe")).status_code == 422
        assert api.post("/procurement/suppliers", "staff", json=supplier_body(performance_score=101)).status_code == 422

    def test_edits_including_clearing_nullable_fields(self, api):
        created = api.post("/procurement/suppliers", "staff", json=supplier_body()).json()
        edited = api.patch(f"/procurement/suppliers/{created['id']}", "staff", json={"contact_email": "orders@harvesthub.internal", "contact_phone": "+1-555-0199", "onboarding_status": "approved"}).json()
        assert edited["contact_email"] == "orders@harvesthub.internal" and edited["onboarding_status"] == "approved"
        cleared = api.patch(f"/procurement/suppliers/{created['id']}", "staff", json={"contact_email": "", "contact_phone": None, "name": None}).json()
        assert cleared["contact_email"] is None and cleared["contact_phone"] is None and cleared["name"] == "Harvest Hub"
        assert api.patch("/procurement/suppliers/nope", "staff", json={"name": "x"}).status_code == 404

    def test_protects_suppliers_that_products_or_orders_depend_on(self, api, db):
        fresh = supplier_named(db, "Fresh Farms Co.")
        res = api.delete(f"/procurement/suppliers/{fresh.id}", "staff")
        assert res.status_code == 409 and "Can't delete" in res.json()["detail"]
        created = api.post("/procurement/suppliers", "staff", json=supplier_body()).json()
        assert api.delete(f"/procurement/suppliers/{created['id']}", "staff").status_code == 204

    def test_a_supplier_that_only_a_product_points_at_is_protected_and_the_product_keeps_it(self, api, db):
        created = api.post("/procurement/suppliers", "staff", json=supplier_body()).json()
        api.post("/inventory/products", "manager", json=product(supplier_id=created["id"]))
        res = api.delete(f"/procurement/suppliers/{created['id']}", "staff")
        assert res.status_code == 409 and "Can't delete" in res.json()["detail"]
        db.expire_all()
        assert sku(db, "SKU-9001").supplier_id == created["id"]  # not quietly detached

    def test_imports_suppliers_by_name_and_reports_bad_rows(self, api, db):
        csv = "\n".join([
            "name,category,contact_email,trn,cold_chain,onboarding_status,performance_score,on_time_pct,late_deliveries_30d",
            "Orchard Direct,Produce,sales@orchard.internal,100999,chilled,approved,88,93.5,1",
            "polar cold logistics,Frozen,,,,,99,,",
            "Bad Email Co,Produce,not-an-email,,,,,,",
            "Bad Status Co,Produce,,,,paused,,,",
            "Bad Score Co,Produce,,,,,150,,",
            ",Produce,,,,,,,",
        ])
        res = api.post("/procurement/suppliers/import", "staff", files=csv_file("vendors.csv", csv)).json()
        assert (res["created"], res["updated"]) == (1, 1)
        assert res["errors"] == [
            "Row 4: contact_email is not a valid email, skipped",
            "Row 5: onboarding_status must be pending, compliance_review, approved or suspended, skipped",
            "Row 6: performance_score must be 0-100, skipped",
            "Row 7: missing name, skipped",
        ]
        db.expire_all()
        assert supplier_named(db, "Polar Cold Logistics").performance_score == 99
        missing = api.post("/procurement/suppliers/import", "staff", files=csv_file("v.csv", "name\nA")).json()
        assert missing["detail"] == "CSV is missing required column(s): category"

    def test_matches_a_name_repeated_in_one_file_to_the_supplier_the_file_just_created(self, api, db):
        csv = "name,category,performance_score\nHarbour Fresh,Produce,70\nharbour fresh,Produce,75"
        res = api.post("/procurement/suppliers/import", "staff", files=csv_file("dup.csv", csv)).json()
        assert (res["created"], res["updated"], res["errors"]) == (1, 1, [])
        assert db.query(Supplier).filter(Supplier.name.ilike("harbour fresh")).count() == 1

    def test_a_short_reimport_leaves_the_columns_it_does_not_have_alone(self, api, db):
        send = lambda text: api.post("/procurement/suppliers/import", "staff", files=csv_file("v.csv", text)).json()  # noqa: E731
        send("name,category,trn,onboarding_status,performance_score,on_time_pct\nKeep Foods,Dairy,100777,approved,91,97.5")
        db.expire_all()
        before = supplier_named(db, "Keep Foods")
        assert (before.trn, before.onboarding_status, before.performance_score, before.on_time_pct) == ("100777", "approved", 91, 97.5)

        assert send("name,category\nKeep Foods,Frozen") == {"created": 0, "updated": 1, "errors": []}
        db.expire_all()
        after = supplier_named(db, "Keep Foods")
        assert (after.category, after.trn, after.onboarding_status, after.performance_score, after.on_time_pct) == ("Frozen", "100777", "approved", 91, 97.5)

        send("name,category,trn\nKeep Foods,Frozen,")  # a blank cell in a column that is present clears it
        db.expire_all()
        cleared = supplier_named(db, "Keep Foods")
        assert (cleared.trn, cleared.onboarding_status, cleared.performance_score) == (None, "approved", 91)


class TestReorderingOutreachAndOrders:
    def test_detects_products_below_their_own_reorder_point_including_stockouts(self, api, db, hq):
        milk = sku(db, "SKU-1101")
        for batch in db.query(Batch).filter(Batch.product_id == milk.id, Batch.store_id == hq.id):
            batch.quantity = 0
        db.commit()
        rows = api.get(f"/procurement/reorder-needed?store_id={hq.id}", "manager").json()
        row = next(r for r in rows if r["product_id"] == milk.id)
        assert (row["current_stock"], row["reorder_threshold"], row["supplier_name"]) == (0, 70, "Nordic Dairy Direct")

    def test_the_seed_has_exactly_one_item_below_its_reorder_point_at_headquarters(self, api, hq):
        rows = api.get(f"/procurement/reorder-needed?store_id={hq.id}", "manager").json()
        assert [(r["product_name"], r["current_stock"], r["reorder_threshold"]) for r in rows] == [("Sourdough Loaf", 32, 55)]

    def test_logs_supplier_outreach_per_click_without_pretending_to_send_anything(self, api, db, hq):
        supplier, milk = supplier_named(db, "Nordic Dairy Direct"), sku(db, "SKU-1101")
        res = api.post(f"/procurement/suppliers/{supplier.id}/notify", "staff", json={"store_id": hq.id, "channel": "email", "product_id": milk.id, "note": "Urgent"})
        assert res.status_code == 201
        body = res.json()
        assert body["channel"] == "email" and body["status"] == "logged" and body["supplier_id"] == supplier.id and body["product_id"] == milk.id
        assert "Whole Milk (2L) is low on stock" in body["message"] and "this is Diego Ramirez from RetailMind" in body["message"] and "Note: Urgent" in body["message"]

        call = api.post(f"/procurement/suppliers/{supplier.id}/notify", "staff", json={"store_id": hq.id, "channel": "call", "note": "Check lead times"}).json()
        assert "Check lead times" in call["reason"] and "nothing dialed" in call["reason"]
        assert api.post(f"/procurement/suppliers/{supplier.id}/notify", "staff", json={"store_id": hq.id, "channel": "pigeon"}).json()["detail"] == "channel must be 'email' or 'call'"
        assert api.post("/procurement/suppliers/nope/notify", "staff", json={"store_id": hq.id, "channel": "email"}).status_code == 404

        log = api.get(f"/procurement/contact-log?store_id={hq.id}", "manager").json()
        assert len(log) == 2 and log[0]["created_at"] >= log[1]["created_at"]
        assert db.query(SupplierContactLog).filter(SupplierContactLog.status == "logged").count() == 2

    def test_lists_orders_per_store_and_approves_or_rejects_drafts_exactly_once(self, api, db, hq):
        orders = api.get(f"/procurement/orders?store_id={hq.id}", "manager").json()
        assert len(orders) == 1
        assert (orders[0]["po_number"], orders[0]["status"], orders[0]["total_cost"], orders[0]["created_from"]) == ("PO-1042", "draft", 3180, "forecast")
        assert (orders[0]["items"][0]["quantity"], orders[0]["items"][0]["unit_cost"]) == (340, 9.35)

        # Priya lacks Purchase Approvals; Marcus (admin) has them.
        assert api.patch(f"/procurement/orders/{orders[0]['id']}/approve", "manager", json={"decided_by": "x"}).status_code == 403
        assert api.patch(f"/procurement/orders/{orders[0]['id']}/approve", "admin", json={"decided_by": "x"}).json()["status"] == "approved"
        again = api.patch(f"/procurement/orders/{orders[0]['id']}/reject", "admin", json={"decided_by": "x"})
        assert (again.status_code, again.json()) == (409, {"detail": "Order is already approved"})
        assert api.get(f"/procurement/orders?store_id={hq.id}&status=draft", "manager").json() == []

        riverside = db.query(Store).filter(Store.name == "Riverside Mall").one()
        draft = api.get(f"/procurement/orders?store_id={riverside.id}", "admin").json()[0]
        assert api.patch(f"/procurement/orders/{draft['id']}/reject", "admin", json={"decided_by": "x"}).json()["status"] == "rejected"
        assert api.patch("/procurement/orders/nope/approve", "admin", json={"decided_by": "x"}).status_code == 404
        assert api.patch(f"/procurement/orders/{draft['id']}/approve", "admin", json={}).status_code == 422

    def test_a_manager_with_the_responsibility_can_approve(self, api, db, hq):
        riverside = db.query(Store).filter(Store.name == "Riverside Mall").one()
        draft = api.get(f"/procurement/orders?store_id={riverside.id}", "riverside").json()[0]  # Hana holds Purchase Approvals
        assert api.patch(f"/procurement/orders/{draft['id']}/approve", "riverside", json={"decided_by": user_by_email(db, "hana@retailmind.app").id}).json()["status"] == "approved"
