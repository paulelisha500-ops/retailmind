"""
Start over from the original data. Off unless ALLOW_WORKSPACE_RESET is set, because it deletes everything: it exists
so the end-to-end tests can return a server to a known starting point between runs, and for a throwaway deployment
that wants a reset button. When the flag is off the route does not exist (404), not "forbidden".
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import seed
from app.config import settings
from app.database import get_db
from app.models import User
from app.security import require_admin

router = APIRouter(prefix="/workspace", tags=["workspace"])


@router.post("/reset")
def reset_workspace(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    if not settings.allow_workspace_reset:
        raise HTTPException(status_code=404, detail="Not Found")
    seed.clear(db)
    seed.populate(db)
    return {"status": "ok"}
