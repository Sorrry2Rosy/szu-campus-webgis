import argparse

from .db import Databases, connection, initialize


def seed_demo(dsn: str) -> bool:
    with connection(dsn) as db, db.cursor() as cursor:
        inserted = db.execute("INSERT INTO seed_runs (name) VALUES ('demo-v1') ON CONFLICT DO NOTHING")
        if inserted.rowcount == 0:
            return False

        light = db.execute(
            """
            INSERT INTO facilities (name, category, longitude, latitude, source, is_mock)
            VALUES (%s, %s, %s, %s, %s, TRUE) RETURNING id
            """,
            ("教学演示路灯 A", "light", 113.9301, 22.5325, "课程自编模拟点位"),
        ).fetchone()["id"]
        cursor.executemany(
            """
            INSERT INTO facilities (name, category, longitude, latitude, source, is_mock)
            VALUES (%s, %s, %s, %s, %s, TRUE)
            """,
            [
                ("教学演示道路点 B", "road", 113.9302, 22.5325, "课程自编模拟点位"),
                ("教学演示公共座椅 C", "facility", 113.9306, 22.5325, "课程自编模拟点位"),
            ],
        )

        cursor.executemany(
            """
            INSERT INTO issues (
                category, title, description, longitude, latitude, status, source,
                note, is_mock, facility_id
            ) VALUES (%s, %s, '课程教学模拟工单', %s, %s, %s, %s, %s, TRUE, %s)
            """,
            [
                ("light", "路灯不亮（模拟）", 113.9301, 22.53258, "pending", "student", "", light),
                ("light", "路灯闪烁（模拟）", 113.9301, 22.53265, "processing", "inspection", "已登记（模拟）", light),
                ("light", "远处路灯不亮（模拟）", 113.9301, 22.53285, "pending", "student", "", None),
                ("light", "已修复路灯（模拟）", 113.9301, 22.53254, "resolved", "inspection", "已修复（模拟）", light),
                ("road", "路面破损（模拟）", 113.93013, 22.5325, "pending", "student", "", None),
            ],
        )
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description="初始化校园 WebGIS 的 PostgreSQL 业务库与账户库")
    parser.add_argument("--demo", action="store_true", help="导入一次课程模拟设施及工单")
    args = parser.parse_args()
    databases = Databases.from_environment()
    initialize(databases)
    print("业务库和账户库已就绪。")
    if args.demo:
        print("模拟数据已写入。" if seed_demo(databases.business) else "该业务库已导入过模拟数据。")


if __name__ == "__main__":
    main()
