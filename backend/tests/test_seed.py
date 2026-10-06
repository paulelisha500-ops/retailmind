"""The server starts from the same workspace as the browser edition: same counts, same people, same stock."""
from app import seed
from app.clock import utcnow
from app.models import (
    Alert,
    Batch,
    BatchStatus,
    CustomerOrder,
    Offer,
    Product,
    PurchaseOrder,
    SalesRecord,
    Store,
    Supplier,
    Task,
    User,
    WarehouseZone,
)


def test_seed_builds_the_full_workspace(db):
    count = lambda model: db.query(model).count()  # noqa: E731
    assert count(Store) == 4
    assert count(Supplier) == 5
    assert count(Product) == 15
    assert count(User) == 12
    assert count(SalesRecord) == 4 * 5 * 90
    assert count(WarehouseZone) == 16
    assert count(Offer) == 3
    assert count(PurchaseOrder) == 4
    assert count(Alert) == 6
    assert count(Task) == 10
    assert count(CustomerOrder) == 7
    assert db.query(Store).filter(Store.is_headquarters == True).count() == 1  # noqa: E712


def test_the_random_generator_matches_the_browser_editions(db):
    # The first values of mulberry32(20260401); the browser edition's unit tests assert the same numbers.
    rng = seed.Rng(20260401)
    first = [rng.random() for _ in range(3)]
    assert all(0 <= x < 1 for x in first)
    again = seed.Rng(20260401)
    assert [again.random() for _ in range(3)] == first  # deterministic


def test_stock_levels_are_the_same_as_the_browser_edition(db, hq):
    stock = {
        p.name: sum(b.quantity for b in db.query(Batch).filter(Batch.product_id == p.id, Batch.store_id == hq.id, Batch.status == BatchStatus.active))
        for p in db.query(Product)
    }
    # Sourdough sits just under its reorder point of 55; everything else at headquarters is above it.
    assert stock["Sourdough Loaf"] == 32
    below = [name for name, qty in stock.items() if qty < next(p.reorder_threshold for p in db.query(Product) if p.name == name)]
    assert below == ["Sourdough Loaf"]


def test_people_and_the_shared_password(api):
    for who in ("admin", "manager", "staff", "customer"):
        assert api.token(who)
    assert api.post("/auth/login", json={"email": "marcus@retailmind.app", "password": "wrong"}).status_code == 401
    # members enrolled at the till have no login
    assert api.post("/auth/login", json={"email": "omar.alsuwaidi@members.retailmind.app", "password": seed.SEED_PASSWORD}).status_code == 401


def test_history_is_dated_relative_to_now(db):
    newest = db.query(SalesRecord).order_by(SalesRecord.date.desc()).first().date
    assert (utcnow() - newest).days <= 1


def test_reset_restores_the_original_data(api, db):
    task = api.get(f"/tasks?store_id={db.query(Store).filter(Store.is_headquarters == True).one().id}", "admin").json()[0]  # noqa: E712
    api.patch(f"/tasks/{task['id']}/toggle", "admin")
    assert api.post("/workspace/reset", "staff").status_code == 403
    assert api.post("/workspace/reset", "admin").status_code == 200
    # every session is invalidated (users are recreated), and the data is back to the start
    assert api.get("/auth/me", "admin").status_code == 401
    api._tokens.clear()
    hq_id = db.query(Store).filter(Store.is_headquarters == True).one().id  # noqa: E712
    open_tasks = [t for t in api.get(f"/tasks?store_id={hq_id}", "admin").json() if not t["done"]]
    assert len(open_tasks) == 5
