from dataclasses import dataclass, field
import json
import os
from pathlib import Path

import psycopg
from psycopg.conninfo import conninfo_to_dict
from psycopg.rows import DictRow, dict_row

DatabaseConnection = psycopg.Connection[DictRow]


@dataclass(frozen=True)
class Databases:
    business: str = field(repr=False)
    accounts: str = field(repr=False)

    @classmethod
    def from_environment(cls) -> "Databases":
        business = os.getenv("CAMPUS_DB_DSN", "").strip()
        accounts = os.getenv("CAMPUS_ACCOUNTS_DSN", "").strip()
        if not business or not accounts:
            raise RuntimeError("请先设置 CAMPUS_DB_DSN 和 CAMPUS_ACCOUNTS_DSN")
        return cls(business, accounts)


def connection(dsn: str) -> DatabaseConnection:
    options = conninfo_to_dict(dsn).get("options", "")
    return psycopg.connect(
        dsn, row_factory=dict_row, connect_timeout=5, options=f"{options} -c timezone=UTC"
    )


def initialize(databases: Databases) -> None:
    for dsn, filename in (
        (databases.business, "schema.sql"),
        (databases.accounts, "accounts.sql"),
    ):
        schema = Path(__file__).with_name(filename).read_text(encoding="utf-8")
        with connection(dsn) as db:
            # 多个服务进程同时启动时，按数据库串行建表。
            db.execute("SELECT pg_advisory_xact_lock(328317, 1)")
            db.execute(schema)
            if filename == "schema.sql":
                catalog = Path(__file__).with_name("building_name_supplements.json")
                names = json.loads(catalog.read_text(encoding="utf-8"))
                with db.cursor() as cursor:
                    cursor.executemany(
                        "INSERT INTO building_name_supplements (building_key, name, annotation_id) "
                        "VALUES (%s, %s, %s) ON CONFLICT (building_key) DO NOTHING",
                        [(key, row["name"], row["annotation_id"]) for key, row in names.items()],
                    )
