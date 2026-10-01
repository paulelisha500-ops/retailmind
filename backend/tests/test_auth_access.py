"""Sign-in, sessions, role-based access, team management, and the staff basics (stores, tasks, alerts, notifications)."""
import time

from jose import jwt

from app.config import settings
from app.models import Batch, Store, User
from tests.conftest import PASSWORD, user_by_email


class TestLogin:
    def test_returns_a_bearer_token_with_role_and_access_level(self, api):
        res = api.post("/auth/login", json={"email": "MARCUS@retailmind.app ", "password": PASSWORD})
        assert res.status_code == 200
        assert res.json() | {"access_token": "x"} == {"access_token": "x", "token_type": "bearer", "role": "employee", "access_level": "admin"}
        customer = api.post("/auth/login", json={"email": "layla@members.retailmind.app", "password": PASSWORD}).json()
        assert customer["role"] == "customer" and customer["access_level"] is None

    def test_one_generic_message_for_a_wrong_password_and_an_unknown_email(self, api):
        wrong = api.post("/auth/login", json={"email": "priya@retailmind.app", "password": "nope"})
        unknown = api.post("/auth/login", json={"email": "ghost@retailmind.app", "password": "nope"})
        assert (wrong.status_code, wrong.json()) == (401, {"detail": "Incorrect email or password"})
        assert (unknown.status_code, unknown.json()) == (401, {"detail": "Incorrect email or password"})

    def test_validates_the_payload(self, api):
        res = api.post("/auth/login", json={"email": "not-an-email", "password": "x"})
        assert res.status_code == 422
        assert res.json()["detail"][0]["loc"] == ["body", "email"]
        assert api.post("/auth/login", json={"email": "a@b.co"}).status_code == 422

    def test_rate_limits_repeated_failures_per_email(self, api):
        from app.routers import auth

        auth._failed_logins.clear()
        for _ in range(8):
            last = api.post("/auth/login", json={"email": "diego@retailmind.app", "password": "bad"})
        assert last.status_code == 401
        blocked = api.post("/auth/login", json={"email": "diego@retailmind.app", "password": PASSWORD})
        assert blocked.status_code == 429
        assert "retry-after" in blocked.headers
        # a different account is unaffected by that email's failures
        assert api.post("/auth/login", json={"email": "priya@retailmind.app", "password": PASSWORD}).status_code == 200
        auth._failed_logins.clear()

    def test_members_enrolled_at_the_till_cannot_sign_in(self, api):
        res = api.post("/auth/login", json={"email": "omar.alsuwaidi@members.retailmind.app", "password": PASSWORD})
        assert res.status_code == 401


class TestTokens:
    def test_rejects_missing_malformed_tampered_and_expired_tokens(self, api, db):
        assert api.get("/auth/me").json() == {"detail": "Not authenticated"}
        bad = api.get("/auth/me", headers={"Authorization": "Bearer garbage"})
        assert (bad.status_code, bad.json()) == (401, {"detail": "Could not validate credentials"})

        good = api.token("admin")
        head, payload, sig = good.split(".")
        assert api.get("/auth/me", headers={"Authorization": f"Bearer {head}.{payload[:-2]}xx.{sig}"}).status_code == 401

        user = user_by_email(db, "marcus@retailmind.app")
        expired = jwt.encode({"sub": user.id, "exp": int(time.time()) - 60}, settings.jwt_secret, algorithm="HS256")
        assert api.get("/auth/me", headers={"Authorization": f"Bearer {expired}"}).status_code == 401
        unknown = jwt.encode({"sub": "nobody", "exp": int(time.time()) + 600}, settings.jwt_secret, algorithm="HS256")
        assert api.get("/auth/me", headers={"Authorization": f"Bearer {unknown}"}).status_code == 401
        wrong_key = jwt.encode({"sub": user.id, "exp": int(time.time()) + 600}, "some-other-secret", algorithm="HS256")
        assert api.get("/auth/me", headers={"Authorization": f"Bearer {wrong_key}"}).status_code == 401

    def test_returns_the_profile_without_secret_fields(self, api):
        body = api.get("/auth/me", "manager").json()
        assert body["name"] == "Priya Sharma" and body["access_level"] == "manager" and body["role"] == "employee"
        assert "hashed_password" not in body


class TestPreferences:
    def test_updates_notification_toggles_and_the_preferred_store(self, api, hq):
        res = api.patch("/auth/me", "customer", json={"notify_orders": False, "preferred_store_id": hq.id}).json()
        assert res["notify_orders"] is False and res["preferred_store_id"] == hq.id
        assert api.patch("/auth/me", "customer", json={"preferred_store_id": None}).json()["preferred_store_id"] is None

    def test_ignores_null_toggles_and_rejects_an_unknown_store(self, api):
        assert api.patch("/auth/me", "staff", json={"notify_restock": None}).json()["notify_restock"] is True
        res = api.patch("/auth/me", "staff", json={"preferred_store_id": "nope"})
        assert (res.status_code, res.json()) == (404, {"detail": "Store not found"})


class TestRoutes:
    def test_unknown_paths_404_and_the_wrong_verb_405s(self, api):
        assert api.get("/nowhere").status_code == 404
        assert api.delete("/auth/me").status_code == 405

    def test_health_needs_no_sign_in(self, api):
        assert api.get("/health").json()["status"] == "ok"


class TestRoleBasedAccess:
    def test_keeps_staff_screens_away_from_customers(self, api, hq):
        for path in (f"/team?store_id={hq.id}", f"/alerts?store_id={hq.id}", f"/tasks?store_id={hq.id}", "/procurement/suppliers", "/inventory/products"):
            res = api.get(path, "customer")
            assert (res.status_code, res.json()) == (403, {"detail": "Staff access required"}), path

    def test_keeps_the_customer_app_away_from_staff(self, api):
        res = api.get("/customer/products", "staff")
        assert (res.status_code, res.json()) == (403, {"detail": "Customer account required"})

    def test_requires_sign_in_everywhere(self, api):
        for path in ("/stores", "/team?store_id=x", "/customer/offers", "/analytics/summary"):
            assert api.get(path).status_code == 401, path

    def test_limits_revenue_analytics_to_admins(self, api):
        for who in ("manager", "staff"):
            res = api.get("/analytics/summary", who)
            assert (res.status_code, res.json()) == (403, {"detail": "Admin access required"})
            assert api.get("/analytics/pnl", who).status_code == 403
        assert api.get("/analytics/summary", "admin").status_code == 200

    def test_gates_writes_on_the_specific_responsibility_and_lets_admins_through(self, api):
        product = {"sku": "SKU-RBAC", "name": "Test Item", "category": "Bakery", "price": 5}
        res = api.post("/inventory/products", "staff", json=product)
        assert (res.status_code, res.json()) == (403, {"detail": "Requires the 'Inventory Monitoring' responsibility"})
        assert api.post("/inventory/products", "manager", json=product).status_code == 201
        res = api.post("/procurement/suppliers", "manager", json={"name": "X", "category": "Bakery"})
        assert (res.status_code, res.json()) == (403, {"detail": "Requires the 'Supplier Management' responsibility"})
        assert api.post("/procurement/suppliers", "staff", json={"name": "Acme Bakers", "category": "Bakery"}).status_code == 201
        assert api.post("/procurement/suppliers", "admin", json={"name": "Admin Supplies", "category": "Frozen"}).status_code == 201

    def test_checks_authentication_before_validating_the_body(self, api):
        assert api.post("/team", json={}).status_code == 401
        assert api.post("/team", "manager", json={}).status_code == 403


def new_member(hq, **over):
    return {"name": "Nadia Rahman", "email": "nadia@retailmind.app", "department": "Inventory & Shelf Ops", "title": "Shelf Associate",
            "access_level": "staff", "store_id": hq.id, "responsibilities": ["Inventory Monitoring"]} | over


class TestTeam:
    def test_lists_only_employees_optionally_scoped_to_a_store(self, api, hq):
        everyone = api.get("/team", "manager").json()
        assert len(everyone) == 7 and all(m["department"] and m["access_level"] for m in everyone)
        here = api.get(f"/team?store_id={hq.id}", "manager").json()
        assert sorted(m["name"] for m in here) == ["Aisha Khan", "Diego Ramirez", "Marcus Tan", "Priya Sharma"]
        assert "hashed_password" not in here[0]

    def test_an_admin_adds_a_member_who_signs_in_with_the_one_time_password(self, api, hq):
        res = api.post("/team", "admin", json=new_member(hq))
        assert res.status_code == 201
        body = res.json()
        assert body["name"] == "Nadia Rahman" and body["email"] == "nadia@retailmind.app" and body["access_level"] == "staff"
        assert len(body["temporary_password"]) == 12
        signed_in = api.post("/auth/login", json={"email": "nadia@retailmind.app", "password": body["temporary_password"]})
        assert signed_in.status_code == 200
        assert api.post("/auth/login", json={"email": "nadia@retailmind.app", "password": PASSWORD}).status_code == 401

    def test_validates_new_members(self, api, hq):
        dup = api.post("/team", "admin", json=new_member(hq, email="MARCUS@retailmind.app"))
        assert (dup.status_code, dup.json()) == (409, {"detail": "A user with that email already exists"})
        nostore = api.post("/team", "admin", json=new_member(hq, email="new@retailmind.app", store_id="nope"))
        assert (nostore.status_code, nostore.json()) == (404, {"detail": "Store not found"})
        level = api.post("/team", "admin", json=new_member(hq, email="new@retailmind.app", access_level="owner"))
        assert (level.status_code, level.json()) == (422, {"detail": "access_level must be staff, manager, or admin"})
        blank = api.post("/team", "admin", json=new_member(hq, email="new@retailmind.app", name="   "))
        assert blank.status_code == 422
        assert blank.json()["detail"][0]["loc"] == ["body", "name"] and blank.json()["detail"][0]["msg"] == "Value error, must not be blank"
        assert api.post("/team", "admin", json=new_member(hq, email="bad-email")).status_code == 422

    def test_protects_accounts_that_have_history_and_the_admins_own_account(self, api, db):
        marcus, priya = user_by_email(db, "marcus@retailmind.app"), user_by_email(db, "priya@retailmind.app")
        own = api.delete(f"/team/{marcus.id}", "admin")
        assert (own.status_code, own.json()) == (409, {"detail": "You can't remove your own account"})
        history = api.delete(f"/team/{priya.id}", "admin")
        assert (history.status_code, history.json()) == (409, {"detail": "Can't remove this member — they have orders, tasks, or approvals on record"})
        assert api.delete("/team/does-not-exist", "admin").status_code == 404

    def test_removes_a_member_with_no_history(self, api, hq):
        created = api.post("/team", "admin", json=new_member(hq, email="temp@retailmind.app", name="Temp Hire")).json()
        assert api.delete(f"/team/{created['id']}", "admin").status_code == 204
        assert created["id"] not in [m["id"] for m in api.get(f"/team?store_id={hq.id}", "admin").json()]

    def test_a_customer_id_cannot_be_removed_through_the_team_route(self, api, db):
        layla = user_by_email(db, "layla@members.retailmind.app")
        assert api.delete(f"/team/{layla.id}", "admin").status_code == 404


class TestStoresTasksAlerts:
    def test_lists_stores_alphabetically_for_any_signed_in_user(self, api):
        stores = api.get("/stores", "customer").json()
        assert [s["name"] for s in stores] == ["Airport Plaza", "Downtown Central", "North Hills", "Riverside Mall"]
        assert next(s for s in stores if s["name"] == "Downtown Central")["is_headquarters"] is True

    def test_orders_tasks_open_first_newest_first_and_toggles_them(self, api, hq):
        tasks = api.get(f"/tasks?store_id={hq.id}", "staff").json()
        assert len(tasks) == 6
        first_done = next(i for i, t in enumerate(tasks) if t["done"])
        assert all(t["done"] for t in tasks[first_done:])
        assert api.get("/tasks", "staff").status_code == 422

        task = next(t for t in tasks if not t["done"])
        assert api.patch(f"/tasks/{task['id']}/toggle", "staff").json()["done"] is True
        assert api.patch(f"/tasks/{task['id']}/toggle", "staff").json()["done"] is False
        assert api.patch("/tasks/nope/toggle", "staff").status_code == 404

    def test_filters_and_resolves_alerts(self, api, hq):
        alerts = api.get(f"/alerts?store_id={hq.id}", "inspector").json()
        assert sorted(a["kind"] for a in alerts) == ["quality", "stock", "theft"]
        theft = next(a for a in alerts if a["kind"] == "theft")
        assert api.patch(f"/alerts/{theft['id']}/resolve", "inspector").json()["status"] == "resolved"
        still_open = api.get(f"/alerts?store_id={hq.id}&status=open", "inspector").json()
        assert theft["id"] not in [a["id"] for a in still_open]
        assert api.patch("/alerts/nope/resolve", "inspector").status_code == 404

    def test_builds_notifications_from_the_users_own_preferences(self, api, hq):
        before = api.get(f"/notifications?store_id={hq.id}", "manager").json()
        assert any(n["kind"] == "alert" for n in before)
        assert all(n["created_at"].endswith("Z") for n in before)
        api.patch("/auth/me", "manager", json={"notify_restock": False, "notify_security": False, "notify_orders": False})
        assert api.get(f"/notifications?store_id={hq.id}", "manager").json() == []

    def test_the_theft_alert_notification_is_titled_for_loss_prevention(self, api, hq):
        titles = [n["title"] for n in api.get(f"/notifications?store_id={hq.id}", "admin").json()]
        assert "Loss prevention alert · Checkout Zone · Lane 3" in titles

    def test_timestamps_carry_an_explicit_utc_marker(self, api, hq):
        for alert in api.get(f"/alerts?store_id={hq.id}", "admin").json():
            assert alert["created_at"].endswith("Z")
        for order in api.get(f"/procurement/orders?store_id={hq.id}", "admin").json():
            assert order["need_by"].endswith("Z")


def test_the_stock_table_is_untouched_by_reads(api, db, hq):
    before = db.query(Batch).count()
    api.get(f"/notifications?store_id={hq.id}", "admin")
    api.get(f"/inventory/shelf-fill?store_id={hq.id}", "admin")
    assert db.query(Batch).count() == before
    assert db.query(Store).count() == 4 and db.query(User).count() == 12
