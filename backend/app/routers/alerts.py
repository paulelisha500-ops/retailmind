from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Alert, AlertStatus, User
from app.schemas import AlertOut
from app.security import require_employee

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get("", response_model=list[AlertOut])
def list_alerts(
    store_id: str,
    status: str | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_employee),
):
    """This is what the CCTV Command Center screen polls. In production,
    rows here are inserted by the CV inference service (see
    app/ml/README notes) the moment YOLO/SAM/ViT flags something —
    never edited directly by a client."""
    q = db.query(Alert).filter(Alert.store_id == store_id)
    if status:
        q = q.filter(Alert.status == status)
    return q.order_by(Alert.created_at.desc()).all()


@router.patch("/{alert_id}/resolve", response_model=AlertOut)
def resolve_alert(alert_id: str, db: Session = Depends(get_db), user: User = Depends(require_employee)):
    """'Mark reviewed' in the UI. Deliberately named resolve, not
    'confirm-theft' or similar — the alert is closed because a human looked
    at it, not because the AI's flag was proven correct."""
    alert = db.query(Alert).filter(Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    alert.status = AlertStatus.resolved
    alert.resolved_at = datetime.utcnow()
    db.commit()
    db.refresh(alert)
    return alert
