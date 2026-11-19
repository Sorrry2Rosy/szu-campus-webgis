from datetime import datetime
from hashlib import sha256
import json
import os
import unittest
from uuid import uuid4

import httpx
from psycopg import sql
from psycopg.conninfo import make_conninfo

from app.db import Databases, connection
from app.init_db import seed_demo
from app.main import create_app

TEST_BUSINESS = os.getenv("CAMPUS_TEST_DB_DSN")
TEST_ACCOUNTS = os.getenv("CAMPUS_TEST_ACCOUNTS_DSN")


@unittest.skipUnless(TEST_BUSINESS and TEST_ACCOUNTS, "请设置两个 PostgreSQL 测试库 DSN")
class ApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.databases = Databases(self.isolated_schema(TEST_BUSINESS), self.isolated_schema(TEST_ACCOUNTS))
        self.client = await self.open_client()

    def isolated_schema(self, dsn):
        name = "test_" + uuid4().hex
        with connection(dsn) as db:
            db.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(name)))

        def cleanup():
            with connection(dsn) as db:
                db.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(name)))

        self.addCleanup(cleanup)
        return make_conninfo(dsn, options=f"-c search_path={name}")

    async def open_client(self):
        app = create_app(self.databases)
        await self.enterAsyncContext(app.router.lifespan_context(app))
        return await self.enterAsyncContext(httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://testserver"
        ))

    @staticmethod
    def issue_data(**changes):
        return {
            "category": "light",
            "title": "演示路灯故障",
            "description": "课程测试数据",
            "longitude": 113.9301,
            "latitude": 22.5325,
            "source": "student",
            "is_mock": True,
            **changes,
        }

    async def create_issue(self, **changes):
        response = await self.client.post("/api/issues", json=self.issue_data(**changes))
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    async def test_create_filter_update_restart_and_delete(self):
        issue = await self.create_issue(source="inspection")
        self.assertEqual(issue["status"], "pending")
        self.assertTrue(issue["is_mock"])
        await self.create_issue(category="road")
        path = f"/api/issues/{issue['id']}"
        listed = await self.client.get("/api/issues", params={"status": "pending", "category": "light"})
        self.assertEqual(listed.json(), [issue])

        update = await self.client.patch(
            path, json={"status": "processing", "description": "确认灯具损坏", "note": "已安排检查"}
        )
        self.assertEqual(update.status_code, 200, update.text)
        updated = update.json()
        self.assertEqual(updated["status"], "processing")
        self.assertEqual(updated["description"], "确认灯具损坏")
        self.assertEqual(updated["note"], "已安排检查")
        self.assertEqual(updated["created_at"], issue["created_at"])
        self.assertGreater(
            datetime.fromisoformat(updated["updated_at"]), datetime.fromisoformat(issue["updated_at"])
        )

        reopened_client = await self.open_client()
        self.assertEqual((await reopened_client.get(path)).json(), updated)
        resolved = await reopened_client.patch(path, json={"status": "resolved"})
        self.assertEqual(resolved.status_code, 200, resolved.text)
        self.assertEqual(resolved.json()["note"], "已安排检查")
        deleted = await reopened_client.delete(path)
        self.assertEqual((deleted.status_code, deleted.content), (204, b""))
        self.assertEqual((await reopened_client.get(path)).status_code, 404)
        self.assertEqual((await reopened_client.patch(path, json={"note": "修改"})).status_code, 404)
        self.assertEqual((await reopened_client.delete(path)).status_code, 404)

    async def test_reject_invalid_inputs_and_invalid_transition(self):
        for changes in (
            {"title": "   "}, {"description": "\x00"}, {"longitude": 181}, {"latitude": 100},
            {"latitude": True}, {"is_mock": "true"}, {"source": "other"}, {"facility_id": 999},
        ):
            with self.subTest(changes=changes):
                invalid = await self.client.post("/api/issues", json=self.issue_data(**changes))
                self.assertEqual(invalid.status_code, 422, invalid.text)
        nonfinite = await self.client.post(
            "/api/issues",
            content=json.dumps(self.issue_data(longitude=float("nan"))),
            headers={"Content-Type": "application/json"},
        )
        self.assertEqual(nonfinite.status_code, 422, nonfinite.text)
        self.assertEqual((await self.client.get("/api/stats/issues")).json()["total"], 0)

        issue = await self.create_issue(is_mock=False)
        path = f"/api/issues/{issue['id']}"
        for invalid_patch in ({}, {"title": None}, {"status": "closed"}, {"is_mock": True}):
            invalid = await self.client.patch(path, json=invalid_patch)
            self.assertEqual(invalid.status_code, 422, invalid.text)
        transition = await self.client.patch(path, json={"status": "resolved", "note": "测试回滚"})
        self.assertEqual(transition.status_code, 409, transition.text)
        self.assertEqual((await self.client.delete(path)).status_code, 403)
        self.assertEqual((await self.client.get(path)).json(), issue)
        self.assertEqual((await self.client.get("/api/issues?status=closed")).status_code, 422)

    async def test_nearby_inclusive_boundary_category_and_status(self):
        # 同经度的固定坐标分别距查询点约 8、19.99、20.00、20.01 米。
        near = await self.create_issue(latitude=22.532572242898578)
        inside = await self.create_issue(latitude=22.532680516941614)
        boundary = await self.create_issue(latitude=22.532680607245233)
        await self.create_issue(latitude=22.53268069754885)
        await self.create_issue(category="road")
        done = await self.create_issue()
        for issue_id, status in (
            (inside["id"], "processing"), (done["id"], "processing"), (done["id"], "resolved"),
        ):
            response = await self.client.patch(f"/api/issues/{issue_id}", json={"status": status})
            self.assertEqual(response.status_code, 200, response.text)

        params = {"lng": 113.9301, "lat": 22.5325, "category": "light"}
        response = await self.client.get("/api/issues/nearby", params=params)
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual((result["count"], result["radius_m"]), (3, 20))
        self.assertEqual([item["id"] for item in result["items"]], [
            near["id"], inside["id"], boundary["id"]
        ])
        self.assertEqual([item["distance_m"] for item in result["items"]], [8.0, 19.99, 20.0])
        smaller = await self.client.get("/api/issues/nearby", params={**params, "radius": 10})
        self.assertEqual(smaller.json()["count"], 1)
        for invalid in ({"radius": 0}, {"radius": "inf"}, {"lat": "nan"}, {"lng": -181}):
            response = await self.client.get("/api/issues/nearby", params={**params, **invalid})
            self.assertEqual(response.status_code, 422, response.text)

    async def test_demo_facilities_statistics_and_repeat_initialization(self):
        self.assertEqual((await self.client.get("/api/stats/issues")).json(), {
            "total": 0, "by_status": {"pending": 0, "processing": 0, "resolved": 0}, "by_category": {},
        })
        self.assertTrue(seed_demo(self.databases.business))
        self.assertFalse(seed_demo(self.databases.business))
        stats = await self.client.get("/api/stats/issues")
        self.assertEqual(stats.json(), {
            "total": 5,
            "by_status": {"pending": 3, "processing": 1, "resolved": 1},
            "by_category": {"light": 4, "road": 1},
        })
        facilities = (await self.client.get("/api/facilities")).json()
        self.assertEqual(len(facilities), 3)
        self.assertTrue(all(facility["is_mock"] for facility in facilities))
        filtered = (await self.client.get("/api/facilities?category=light")).json()
        issue = await self.create_issue(facility_id=filtered[0]["id"])
        self.assertEqual(issue["facility_id"], filtered[0]["id"])
        update = await self.client.patch(f"/api/issues/{issue['id']}", json={"facility_id": None})
        self.assertEqual(update.status_code, 200, update.text)
        self.assertIsNone(update.json()["facility_id"])

    async def test_openapi_health_and_frontend_preflight(self):
        self.assertEqual((await self.client.get("/api/health")).json(), {"status": "ok"})
        schema = await self.client.get("/openapi.json")
        self.assertEqual(schema.status_code, 200, schema.text)
        self.assertIn("/api/issues/nearby", schema.json()["paths"])
        self.assertIn("/api/auth/login", schema.json()["paths"])
        origin = "http://127.0.0.1:5500"
        preflight = await self.client.options("/api/issues/1", headers={
            "Origin": origin,
            "Access-Control-Request-Method": "PATCH",
            "Access-Control-Request-Headers": "Content-Type",
        })
        self.assertEqual(preflight.status_code, 200, preflight.text)
        self.assertEqual(preflight.headers["access-control-allow-origin"], origin)
        self.assertIn("Authorization", preflight.headers["access-control-allow-headers"])

    async def test_account_registration_login_persistence_expiry_and_logout(self):
        credentials = {"username": "Demo_User", "password": "Course-only-pass-24!"}
        invalid = await self.client.post("/api/auth/register", json={**credentials, "password": "short"})
        self.assertEqual(invalid.status_code, 422, invalid.text)
        registered = await self.client.post("/api/auth/register", json=credentials)
        self.assertEqual(registered.status_code, 201, registered.text)
        account = registered.json()
        self.assertEqual(set(account), {"id", "username", "created_at"})
        self.assertEqual(account["username"], "demo_user")

        duplicate = await self.client.post(
            "/api/auth/register", json={**credentials, "username": "demo_user"}
        )
        self.assertEqual(duplicate.status_code, 409)
        wrong = await self.client.post("/api/auth/login", json={**credentials, "password": "bad-password"})
        self.assertEqual(wrong.status_code, 401)
        unknown = await self.client.post("/api/auth/login", json={**credentials, "username": "missing"})
        self.assertEqual(unknown.json(), wrong.json())
        self.assertEqual((await self.client.get("/api/auth/me")).status_code, 401)

        reopened = await self.open_client()
        logged_in = await reopened.post("/api/auth/login", json=credentials)
        self.assertEqual(logged_in.status_code, 200, logged_in.text)
        session = logged_in.json()
        self.assertEqual(session["token_type"], "bearer")
        self.assertEqual(session["expires_in"], 43200)
        self.assertEqual(session["account"], account)
        token = session["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        self.assertEqual((await self.client.get("/api/auth/me", headers=headers)).json(), account)

        with connection(self.databases.accounts) as db:
            stored = db.execute("SELECT password_hash FROM accounts").fetchone()
            self.assertTrue(stored["password_hash"].startswith("$argon2id$"))
            digest = sha256(token.encode("ascii")).digest()
            row = db.execute("SELECT token_hash FROM account_sessions").fetchone()
            self.assertEqual(row["token_hash"], digest)
            db.execute("UPDATE account_sessions SET expires_at = now()")
        self.assertEqual((await self.client.get("/api/auth/me", headers=headers)).status_code, 401)

        logged_in = await reopened.post("/api/auth/login", json=credentials)
        headers = {"Authorization": f"Bearer {logged_in.json()['access_token']}"}
        logged_out = await self.client.post("/api/auth/logout", headers=headers)
        self.assertEqual((logged_out.status_code, logged_out.content), (204, b""))
        self.assertEqual((await self.client.get("/api/auth/me", headers=headers)).status_code, 401)
