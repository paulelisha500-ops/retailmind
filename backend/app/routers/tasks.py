from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Task, User
from app.schemas import TaskOut
from app.security import require_employee

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.get("", response_model=list[TaskOut])
def list_tasks(
    store_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_employee),
):
    """Backs the Home 'my tasks today' list and the Tasks screen. Rows come
    from whatever created them — shelf monitoring, quality inspection,
    procurement — `source` just labels that origin for the UI."""
    return (
        db.query(Task)
        .filter(Task.store_id == store_id)
        .order_by(Task.done.asc(), Task.created_at.desc())
        .all()
    )


@router.patch("/{task_id}/toggle", response_model=TaskOut)
def toggle_task(task_id: str, db: Session = Depends(get_db), _: User = Depends(require_employee)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    task.done = not task.done
    db.commit()
    db.refresh(task)
    return task
