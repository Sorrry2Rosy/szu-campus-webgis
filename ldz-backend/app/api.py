from collections import Counter
from collections.abc import Iterator
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, Response
from psycopg.errors import ForeignKeyViolation

from . import spatial
from .db import DatabaseConnection, connection
from .models import (
    CATEGORY_PATTERN,
    MAX_RECORD_ID,
    Facility,
    Issue,
    IssueCreate,
    IssuePatch,
    IssueStats,
    NearbyResult,
    Status,
)

router = APIRouter(prefix="/api")

NEXT_STATUS = {"pending": "processing", "processing": "resolved"}
STATUSES = ("pending", "processing", "resolved")
CategoryFilter = Annotated[str, Query(pattern=CATEGORY_PATTERN)]
IssueId = Annotated[int, Path(gt=0, le=MAX_RECORD_ID)]


def get_db(request: Request) -> Iterator[DatabaseConnection]:
    with connection(request.app.state.databases.business) as db:
        yield db


Database = Annotated[DatabaseConnection, Depends(get_db)]


def issue_by_id(db: DatabaseConnection, issue_id: int, *, for_update: bool = False) -> dict:
    query = "SELECT * FROM issues WHERE id = %s"
    if for_update:
        query += " FOR UPDATE"
    row = db.execute(query, (issue_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="工单不存在")
    return row


@router.get("/health", tags=["服务"])
def health(request: Request, db: Database) -> dict[str, str]:
    db.execute("SELECT 1 FROM issues LIMIT 1").fetchone()
    with connection(request.app.state.databases.accounts) as accounts_db:
        accounts_db.execute("SELECT 1 FROM accounts LIMIT 1").fetchone()
    return {"status": "ok"}


@router.get("/issues", response_model=list[Issue], tags=["工单"])
def list_issues(db: Database, status: Status | None = None, category: CategoryFilter | None = None):
    conditions = []
    params = []
    if status is not None:
        conditions.append("status = %s")
        params.append(status)
    if category is not None:
        conditions.append("category = %s")
        params.append(category)

    where = " WHERE " + " AND ".join(conditions) if conditions else ""
    rows = db.execute("SELECT * FROM issues" + where + " ORDER BY id DESC", params)
    return rows.fetchall()


@router.post("/issues", response_model=Issue, status_code=201, tags=["工单"])
def create_issue(payload: IssueCreate, db: Database):
    try:
        with db.transaction():
            return db.execute(
                """
                INSERT INTO issues (
                    category, title, description, longitude, latitude, location_description,
                    source, is_mock, facility_id
                ) VALUES (
                    %(category)s, %(title)s, %(description)s, %(longitude)s, %(latitude)s,
                    %(location_description)s, %(source)s, %(is_mock)s, %(facility_id)s
                )
                RETURNING *
                """,
                payload.model_dump(),
            ).fetchone()
    except ForeignKeyViolation as error:
        raise HTTPException(status_code=422, detail="关联设施不存在") from error


# 注册静态路径后再注册 /issues/{id}。
@router.get("/issues/nearby", response_model=NearbyResult, tags=["工单"])
def nearby_issues(
    db: Database,
    lng: Annotated[float, Query(ge=-180, le=180, allow_inf_nan=False)],
    lat: Annotated[float, Query(ge=-90, le=90, allow_inf_nan=False)],
    category: CategoryFilter,
    radius: Annotated[float, Query(gt=0, allow_inf_nan=False)] = 20,
):
    rows = db.execute(
        """
        SELECT id, category, status, longitude, latitude
        FROM issues
        WHERE category = %s AND status IN ('pending', 'processing')
        """,
        (category,),
    )
    matches = spatial.find_nearby(lng, lat, radius, rows)
    return {"items": matches, "count": len(matches), "radius_m": radius}


@router.get("/issues/{id}", response_model=Issue, tags=["工单"])
def get_issue(id: IssueId, db: Database):
    return issue_by_id(db, id)


@router.patch("/issues/{id}", response_model=Issue, tags=["工单"])
def update_issue(id: IssueId, payload: IssuePatch, db: Database):
    values = payload.model_dump(exclude_unset=True)
    try:
        with db.transaction():
            current = issue_by_id(db, id, for_update=True)
            new_status = payload.status
            if (
                new_status is not None
                and new_status != current["status"]
                and new_status != NEXT_STATUS.get(current["status"])
            ):
                raise HTTPException(status_code=409, detail="状态只能按待处理、处理中、已完成顺序流转")

            # 列名来自 IssuePatch 的字段定义，输入值通过参数绑定。
            assignments = ", ".join(f"{column} = %s" for column in values)
            return db.execute(
                f"UPDATE issues SET {assignments}, updated_at = statement_timestamp() WHERE id = %s RETURNING *",
                (*values.values(), id),
            ).fetchone()
    except ForeignKeyViolation as error:
        raise HTTPException(status_code=422, detail="关联设施不存在") from error


@router.delete("/issues/{id}", status_code=204, tags=["工单"])
def delete_issue(id: IssueId, db: Database) -> Response:
    with db.transaction():
        row = issue_by_id(db, id, for_update=True)
        if not row["is_mock"]:
            raise HTTPException(status_code=403, detail="只允许删除标记为模拟数据的工单")
        db.execute("DELETE FROM issues WHERE id = %s", (id,))
    return Response(status_code=204)


@router.get("/building-name-supplements", tags=["建筑"])
def building_name_supplements(db: Database):
    return db.execute(
        "SELECT building_key, name, annotation_id FROM building_name_supplements ORDER BY building_key"
    ).fetchall()


@router.get("/facilities", response_model=list[Facility], tags=["设施"])
def list_facilities(db: Database, category: CategoryFilter | None = None):
    sql = "SELECT * FROM facilities"
    params = ()
    if category is not None:
        sql += " WHERE category = %s"
        params = (category,)
    return db.execute(sql + " ORDER BY id", params).fetchall()


@router.get("/stats/issues", response_model=IssueStats, tags=["统计"])
def issue_stats(db: Database):
    by_status = {status: 0 for status in STATUSES}
    by_category = Counter()
    rows = db.execute(
        "SELECT status, category, COUNT(*) AS count FROM issues GROUP BY status, category"
    )
    for row in rows:
        by_status[row["status"]] += row["count"]
        by_category[row["category"]] += row["count"]
    return {
        "total": sum(by_status.values()),
        "by_status": by_status,
        "by_category": dict(sorted(by_category.items())),
    }
