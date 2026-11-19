# 深圳大学粤海校区设施巡检后端

本项目是校园公共设施巡检与问题处置 WebGIS 的 FastAPI 后端。业务数据和账户数据分别保存在两个 PostgreSQL 数据库中。工单、查重、设施和统计接口沿用项目文档 01 的 `/api` 路径和已定义的 JSON 字段。01 未定义账户接口，本版增加了一套独立的账户 JSON 契约。

## 一 在 Windows 上启动

这部分会用到两个提示符。看到 `PS ...>` 时执行标记为 PowerShell 的命令。看到 `postgres=#` 时执行标记为 psql 的命令。复制时只复制代码块里的内容。密码提示出现后，先完成输入并按 Enter，再复制下一条命令。

### 1. 准备运行环境

- Python 3.12，或现有 Anaconda 中的 Python 3.13。
- PostgreSQL 服务和 `psql` 客户端。本版使用 PostgreSQL 17.9 验证。如果已经有可用的 PostgreSQL 实例，可以使用它。需要安装时可从 [PostgreSQL Windows 下载页](https://www.postgresql.org/download/windows/) 获取安装程序。
- 在 PowerShell 中进入包含 `requirements.txt` 的 `ldz-backend` 目录。如果使用这台电脑上已经配置好依赖的项目，可直接执行下面两行。自己解压了 ZIP 的话，只替换第一行引号里的目录。

```powershell
Set-Location 'C:\Users\admin\Documents\Codex\2026-11-07\co-de\work\ldz-backend'
.\.venv\Scripts\python.exe --version
```

如果上面的命令能显示 Python 版本，且项目依赖已安装，直接跳到第 2 步。刚解压的项目需要创建环境，下面两种方式任选一种。每行单独执行，等上一行执行完成再继续。

**方式 A**　Windows 的 `py` 启动器能找到 Python 3.12 时使用。

```powershell
py -3.12 --version
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

**方式 B**　已有 Anaconda 时使用。`py --version` 提示 `No installed Python found!` 表示 Windows 启动器没有找到它能识别的 Python。可以直接运行 Anaconda 的 `python.exe`。这台电脑使用 `E:\anaconda\python.exe`，其他电脑只替换第一行引号里的路径。

```powershell
$campusPython = 'E:\anaconda\python.exe'
& $campusPython --version
& $campusPython -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

第一条版本命令用于确认所用的 Python。`-m venv .venv` 在当前目录创建项目环境，最后一行把 `requirements.txt` 里的依赖装进该环境。后续命令都使用项目目录下的 `.venv\Scripts\python.exe`。

### 2. 创建业务库和账户库

这里有两个数据库角色。**`postgres`** 是 PostgreSQL 管理员，使用你已有的管理员密码。**`campus_app`** 是本项目使用的数据库账号，密码由你在本节新设定。网站注册接口里的用户名和密码属于网站账户，在后面的账户接口中使用。

如果团队已经建好了两个数据库，并给你分配了有建表权限的账号，可以跳到第 3 步，按团队给的连接信息配置。

#### 2.1 从 PowerShell 登录 psql

在 PowerShell **逐行执行**下面两行。第一行把客户端路径存进变量。第二行运行客户端并连接 PostgreSQL。

```powershell
$campusPsql = 'C:\Program Files\PostgreSQL\17\bin\psql.exe'
& $campusPsql -X -h 127.0.0.1 -p 5432 -U postgres -d postgres -W -P pager=off
```

| 命令里的内容 | 用途和替换方法 |
| --- | --- |
| `C:\Program Files\PostgreSQL\17\bin\psql.exe` | psql 的程序路径。只在安装位置或版本不同的时候换成实际路径。 |
| `-h 127.0.0.1 -p 5432` | 连接本机的 5432 端口。本机已验证可用。使用其他实例时，替换地址和端口。 |
| `-U postgres -d postgres` | 前一个 `postgres` 是登录角色，后一个是登录后先进入的已有数据库。用本机默认管理员时原样保留。 |
| `-W` | 让 psql 提示输入密码。看到 `Password:` 或 `口令:` 时输入现有的 **`postgres` 管理员密码**，再按 Enter。输入时屏幕通常不会显示字符。密码里的 `@` 直接输入。 |
| `-X -P pager=off` | 跳过 psql 启动配置并关闭结果分页，避免终端尝试调用 `cat`。 |

成功后会出现 `postgres=#`。这表示已进入 psql，可以执行下一节命令。如果仍看到 `PS ...>`，先处理登录报错再继续。

想核对连到哪个实例，可以在 `postgres=#` 后执行下列查询。本机应看到用户 `postgres`、地址 `127.0.0.1` 和端口 `5432`。

```sql
SELECT current_user, inet_server_addr(), inet_server_port();
```

#### 2.2 在 psql 里逐条建库

**一次只复制一个代码块。按 Enter 后，等结果或下一次提示出现，再复制下一块。** 本机按默认命名搭建时，五条命令都可以原样复制。你只需要在第 2 条命令弹出的提示里输入自己设定的密码。

**第 1 条　创建应用数据库角色。** `campus_app` 是角色名，`LOGIN` 表示允许它登录 PostgreSQL。成功时显示 `CREATE ROLE`。

```sql
CREATE ROLE campus_app LOGIN;
```

**第 2 条　为应用数据库角色设置密码。** 这条是 psql 命令，末尾直接按 Enter。随后会提示输入两次新密码，第二次用来确认。请记住这个密码，第 3 步配置连接时会再次使用。

```text
\password campus_app
```

**第 3 条　创建业务库。** `campus_webgis` 保存工单和设施，`OWNER campus_app` 指定应用角色为库的所有者。`TEMPLATE template0` 从干净模板建库，`ENCODING 'UTF8'` 用于保存中文等字符。成功时显示 `CREATE DATABASE`。

```sql
CREATE DATABASE campus_webgis OWNER campus_app TEMPLATE template0 ENCODING 'UTF8';
```

**第 4 条　创建账户库。** `campus_accounts` 保存网站注册账户和登录会话，使用同一个应用角色和 UTF-8 编码。成功时也显示 `CREATE DATABASE`。

```sql
CREATE DATABASE campus_accounts OWNER campus_app TEMPLATE template0 ENCODING 'UTF8';
```

**第 5 条　退出 psql。** 这条也是 psql 命令，末尾直接按 Enter。看到 `PS ...>` 后，接着执行第 3 步的 PowerShell 命令。

```text
\q
```

如果团队指定了其他名字，按下表一起修改对应位置。SQL 关键字和 `UTF8` 原样保留。

| 想修改的内容 | 需要同步替换的位置 |
| --- | --- |
| 应用角色名 `campus_app` | `CREATE ROLE`、`\password`、两条 `OWNER`，以及第 3 步两个连接串里的用户名 |
| 业务库名 `campus_webgis` | 第 3 条 `CREATE DATABASE` 和第 3 步 `CAMPUS_DB_DSN` 的末尾 |
| 账户库名 `campus_accounts` | 第 4 条 `CREATE DATABASE` 和第 3 步 `CAMPUS_ACCOUNTS_DSN` 的末尾 |

如果提示角色或数据库已存在，可以在 psql 用 `\du campus_app` 和 `\l campus_*` 核对。已有角色的密码仍可用时，跳过 `\password`。已有数据库的所有者正确时，跳过对应的建库命令。如果已有数据库属于别的项目，可以另选库名，并同步改连接串。

### 3. 配置连接并建表

确认已经回到 `PS ...>`，并且当前目录是含 `requirements.txt` 的项目目录。**先单独执行下面这一行**，然后在提示中输入刚用 `\password campus_app` 设置的 **应用数据库密码**。

```powershell
$campusPassword = Read-Host '请输入 campus_app 的数据库密码' -AsSecureString
```

输入完成并回到 PowerShell 提示符后，**整块复制**下面的命令。第一条跨了三行，PowerShell 会在右括号输入完整后执行。

```powershell
$campusPasswordEncoded = [uri]::EscapeDataString(
    [System.Net.NetworkCredential]::new('', $campusPassword).Password
)
$env:CAMPUS_DB_DSN = "postgresql://campus_app:${campusPasswordEncoded}@127.0.0.1:5432/campus_webgis"
$env:CAMPUS_ACCOUNTS_DSN = "postgresql://campus_app:${campusPasswordEncoded}@127.0.0.1:5432/campus_accounts"
Remove-Variable campusPassword,campusPasswordEncoded
```

- `EscapeDataString` 将应用密码中的 `@`、`#` 等字符转成连接串可用的格式。输入密码时按原样输入，连接串中的 `${campusPasswordEncoded}` 原样复制，PowerShell 会自动填入转义后的值。
- 两条 `$env:` 语句分别设置业务库和账户库的连接串。使用默认设置时整块原样复制。自定义时只替换对应的用户名、主机、端口和库名。若两个库使用不同的角色和密码，对每个连接串分别使用该角色的密码做一次输入和转义。
- `Remove-Variable` 清除临时密码变量。上面设置好的两个连接串仍在当前 PowerShell 窗口中生效。

然后**单独执行**下面这一行建表并导入演示数据。

```powershell
.\.venv\Scripts\python.exe -m app.init_db --demo
```

| 环境变量 | 用途 |
| --- | --- |
| `CAMPUS_DB_DSN` | 必填。连接业务库，保存设施、工单和模拟数据导入记录 |
| `CAMPUS_ACCOUNTS_DSN` | 必填。连接账户库，保存账户和登录会话 |
| `CAMPUS_CORS_ORIGINS` | 可选。逗号分隔的前端来源地址，包含协议和端口 |

看到 `业务库和账户库已就绪。` 就可以继续启动。保留 `--demo` 会额外导入 3 个模拟设施和 5 条模拟工单，省略它就只建表。同一业务库重复运行只导入一次。首次启动服务也会检查并建表。连接变量只在当前 PowerShell 会话中生效，换窗口后需要重新设置。

旧版 `data/campus.db` 是 SQLite 文件。如果你已有旧工单，请保留该文件备份。本版初始化的是 PostgreSQL 表，旧文件中的数据需要另行导入。

### 4. 启动和检查

在**设置过连接串的同一个 PowerShell 窗口**执行下面这一行。`app.main:app` 是后端入口，`127.0.0.1:8000` 是 API 地址，PostgreSQL 仍使用它自己的端口。默认值可原样复制。若 8000 被占用，可只改 `--port 8000` 中的数字，随后用新端口访问接口。

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

等终端显示 `Application startup complete` 后，用浏览器打开下面的地址。

- [Swagger 接口文档](http://127.0.0.1:8000/docs) 可查看请求格式和发送测试请求。
- [健康检查](http://127.0.0.1:8000/api/health) 验证业务库和账户库都可读取，应返回 `{"status":"ok"}`。
- [工单列表](http://127.0.0.1:8000/api/issues) 可查看模拟工单。
- [查重示例](http://127.0.0.1:8000/api/issues/nearby?lng=113.9301&lat=22.5325&radius=20&category=light) 应返回两条模拟路灯工单。

在服务窗口按 Ctrl+C 停止 API。数据保留在 PostgreSQL 中，重新启动 API 后仍可读取。

## 二 工单与设施接口

基地址为 `http://127.0.0.1:8000`。POST 和 PATCH 的请求体使用 JSON，发送 `Content-Type: application/json`。路径中的 `{id}` 用实际返回的整数编号替换。

| 方法 | 路径 | 请求和结果 |
| --- | --- | --- |
| GET | `/api/health` | 返回 `{"status":"ok"}` |
| GET | `/api/issues` | 可用 `status` 和 `category` 组合筛选，返回按编号倒序的数组 |
| POST | `/api/issues` | 创建工单，返回完整工单和新 `id`，HTTP 201 |
| GET | `/api/issues/{id}` | 返回指定工单 |
| PATCH | `/api/issues/{id}` | 接收要修改的字段，返回更新后的工单 |
| DELETE | `/api/issues/{id}` | 删除模拟工单，HTTP 204，响应体为空 |
| GET | `/api/issues/nearby` | 必填 `lng`、`lat`、`category`，可选 `radius`，默认 20 米 |
| GET | `/api/facilities` | 可选 `category`，返回设施数组 |
| GET | `/api/stats/issues` | 返回总数、状态计数和类别计数 |

### 上报与查看工单

**POST `/api/issues`** 使用 01 的 JSON 格式。

```json
{
  "category": "light",
  "title": "路灯无法照明（模拟）",
  "description": "教学演示记录，非真实故障",
  "longitude": 113.9301,
  "latitude": 22.5325,
  "source": "student",
  "is_mock": true
}
```

- `category`、`title`、`description`、`longitude`、`latitude` 为必填。经度范围为 −180 至 180，纬度为 −90 至 90。经纬度传 JSON 数字。
- 初始类别使用 `light`（路灯）、`road`（道路）、`facility`（公共设施）。扩展类别使用小写代码，首字符为字母，后续允许字母、数字、下划线或连字符，最长 40 字符。
- `source` 默认 `student`，巡检登记用 `inspection`。`is_mock` 默认 `true`，创建后保留该标记。
- `location_description` 可填写位置描述，`facility_id` 可关联设施。详情还会返回 `id`、`status`、`note`、`created_at`、`updated_at`。时间采用 ISO 8601 UTC。

**GET `/api/issues?status=pending&category=light`** 返回待处理的路灯工单数组。无结果时为 `[]`。

### 修改状态

**PATCH `/api/issues/12`** 的请求体如下。实际操作时将 `12` 替换为要处理的工单编号。

```json
{
  "status": "processing",
  "note": "已安排处理（模拟）"
}
```

状态依次为 `pending` → `processing` → `resolved`，重复提交当前状态有效。工单更新会刷新 `updated_at`。省略 `note` 会保留原值，传空字符串可清空备注。传 `{"facility_id":null}` 可解除设施关联。

### 查重

**GET `/api/issues/nearby?lng=113.9301&lat=22.5325&radius=20&category=light`**。查重只包含相同类别的待处理和处理中工单，按距离升序返回。距离恰好等于查询半径的工单也会返回。以下是空库导入模拟数据后的示例。

```json
{
  "items": [
    {"id": 1, "category": "light", "status": "pending", "distance_m": 8.86},
    {"id": 2, "category": "light", "status": "processing", "distance_m": 16.61}
  ],
  "count": 2,
  "radius_m": 20
}
```

### 统计

**GET `/api/stats/issues`**。以下为初次导入模拟数据后的结果。`by_status` 始终包含三个状态，`by_category` 包含有工单的类别。

```json
{
  "total": 5,
  "by_status": {"pending": 3, "processing": 1, "resolved": 1},
  "by_category": {"light": 4, "road": 1}
}
```

## 三 账户接口

| 方法 | 路径 | 请求和结果 |
| --- | --- | --- |
| POST | `/api/auth/register` | 接收 `username` 和 `password`，HTTP 201，返回账户资料 |
| POST | `/api/auth/login` | 接收相同 JSON，HTTP 200，返回令牌、有效秒数和账户资料 |
| GET | `/api/auth/me` | 发送 `Authorization: Bearer <access_token>`，返回当前账户 |
| POST | `/api/auth/logout` | 发送相同请求头，撤销当前会话，HTTP 204，响应体为空 |

注册和登录请求体如下。用户名去除首尾空白并转为小写，长度为 3 至 32，首字符为字母，后续可用英文字母、数字和下划线。密码长度为 8 至 128 个字符。

```json
{
  "username": "ldz_demo",
  "password": "请改成你的演示密码"
}
```

注册成功和查询当前账户返回同一结构。

```json
{
  "id": 1,
  "username": "ldz_demo",
  "created_at": "2026-11-07T08:00:00Z"
}
```

登录成功的响应示例。实际令牌由服务生成，有效期为 12 小时。

```json
{
  "access_token": "<登录接口返回的令牌>",
  "token_type": "bearer",
  "expires_in": 43200,
  "account": {
    "id": 1,
    "username": "ldz_demo",
    "created_at": "2026-11-07T08:00:00Z"
  }
}
```

使用 Swagger 联调时，先执行 `POST /api/auth/register`，再执行 `POST /api/auth/login`。复制返回的 `access_token`，点右上角 **Authorize**，粘贴令牌值。调用 `GET /api/auth/me` 验证登录，再调用 `POST /api/auth/logout` 验证会话撤销。浏览器直接发送请求时，使用完整的 `Authorization: Bearer <access_token>` 请求头。

账户库保存 Argon2id 密码哈希和会话令牌摘要。登录成功响应会返回令牌值，账户资料只包含编号、用户名和创建时间。本版令牌用于 `/api/auth/me` 和 `/api/auth/logout`。工单和设施接口保留 01 的本地教学演示模式，可继续使用现有前端代码联调。

### 错误响应

| 状态码 | 场景 |
| --- | --- |
| 401 | 用户名或密码错误，或访问当前账户时令牌缺失、无效、已退出或已过期 |
| 403 | 尝试删除非模拟工单 |
| 404 | 工单不存在 |
| 409 | 用户名已存在，或尝试跳过、逆转工单状态 |
| 422 | 请求字段或查询参数不合法，或引用的设施不存在 |
| 503 | 运行中无法连接数据库 |

错误响应的 `detail` 可能是文字，也可能是包含 `loc`、`msg`、`type` 的字段错误数组。处理 204 响应时直接判断状态码即可。

## 四 前端和 GIS 联调

- **ayk** 可在前端目录运行 `python -m http.server 5500 --bind 127.0.0.1`，用 [本地前端地址](http://127.0.0.1:5500) 打开网页。API 默认允许 `localhost` 和 `127.0.0.1` 上的 5500、5173 端口。如果使用其他前端地址，在启动 API 前设置 `$env:CAMPUS_CORS_ORIGINS = "http://127.0.0.1:3000"`。多项用逗号分隔。
- **yzh** 可将最终算法接到 `app/spatial.py` 的 `find_nearby(longitude, latitude, radius_m, candidates)`。业务层已按类别和未解决状态筛选候选工单。每条候选包含 `id`、`category`、`status`、`longitude`、`latitude`。函数返回按距离升序排列的 `id`、`category`、`status` 和 `distance_m`。目前用 PyProj 的 WGS 84 椭球测地线计算米数。
- 设施和工单用 WGS 84 经纬度。GeoJSON 点坐标顺序是 `[longitude, latitude]`。设施导入 `facilities`，模拟工单导入 `issues` 并设置 `is_mock=TRUE`。关联工单用 `facilities.id`。建筑和道路 GeoJSON 仍由前端读取。

## 五 数据表与代码位置

| 数据库 | 表 | 用途 |
| --- | --- | --- |
| `campus_webgis` | `facilities` | 设施名称、类别、坐标、来源和模拟标记 |
| `campus_webgis` | `issues` | 工单、处理状态、备注、时间和设施外键 |
| `campus_webgis` | `seed_runs` | 记录模拟数据是否已导入 |
| `campus_accounts` | `accounts` | 用户名、密码哈希和创建时间 |
| `campus_accounts` | `account_sessions` | 登录令牌摘要、账户外键和过期时间 |

| 文件 | 职责 |
| --- | --- |
| `app/main.py` | FastAPI 入口、启动建表、跨域和错误响应 |
| `app/db.py` | 两个 PostgreSQL 连接配置和初始化 |
| `app/schema.sql`、`app/accounts.sql` | 两个数据库的建表语句 |
| `app/init_db.py` | 初始化命令和模拟数据 |
| `app/api.py`、`app/auth.py` | 业务接口和账户接口 |
| `app/models.py`、`app/spatial.py` | JSON 校验和空间距离计算 |
| `tests/test_api.py` | PostgreSQL 接口集成测试 |

## 六 运行测试和排错

测试使用两个专用 PostgreSQL 测试库。用第 2.1 节的方法登录，看到 `postgres=#` 后逐条执行下面两行。第一行建业务测试库，第二行建账户测试库。如果前面使用了其他应用角色，替换两处 `OWNER` 后的角色名。建完用 `\q` 回到 PowerShell。

```sql
CREATE DATABASE campus_webgis_test OWNER campus_app TEMPLATE template0 ENCODING 'UTF8';
CREATE DATABASE campus_accounts_test OWNER campus_app TEMPLATE template0 ENCODING 'UTF8';
```

按第 3 步配置连接串的方式，把两个环境变量名分别换成 `CAMPUS_TEST_DB_DSN`、`CAMPUS_TEST_ACCOUNTS_DSN`，并把对应库名换成 `campus_webgis_test`、`campus_accounts_test`。测试会在各测试库中创建独立的临时 schema，并在结束时清理。两个变量未设置时，测试会标记为跳过。

在项目目录的 PowerShell 里逐行执行。第一行安装测试依赖，第二行运行测试。

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

测试覆盖工单 CRUD、状态与备注持久化、筛选、统计、设施关联、20 米边界、跨域，以及账户注册、重复用户名、错误密码、会话过期和退出登录。

| 现象 | 检查方法 |
| --- | --- |
| 提示需要设置两个 DSN | 确认初始化与 Uvicorn 从设置过变量的 PowerShell 窗口启动 |
| `connection refused` | 确认 PostgreSQL 服务运行，检查主机和端口 |
| 在第 2.1 节登录 psql 时看到 `password authentication failed for user "postgres"` | 这一阶段用现有的 `postgres` 管理员密码，在提示中原样输入，`@` 无需转义。本机用 `127.0.0.1:5432` 已验证能登录。若再次报错，可用 pgAdmin 的现有连接核对用户名和端口。 |
| 在第 3 步初始化时看到 `password authentication failed for user "campus_app"` | 这一阶段用 `\password campus_app` 设置的项目数据库密码。重新执行第 3 步的输入和转义命令，并核对连接串里的用户名、端口和库名。 |
| psql 提示符从 `postgres=#` 变为 `postgres-#` | psql 正在等待补完 SQL，通常是少了末尾的分号。按 Ctrl+C 可清空当前输入，再完整粘贴这一条。 |
| `database does not exist` | 对照连接串检查两个数据库名称，并先在 PostgreSQL 中建库 |
| `permission denied for schema public` | 确认连接用户是对应数据库的 owner 或在目标 schema 中有建表权限 |
| 浏览器报 CORS | 将页面实际来源加入 `CAMPUS_CORS_ORIGINS` 后重启 API，检查端口与协议 |
| Swagger 可打开但操作报 422 | 展开响应的 `detail`，按 `loc` 找到待修正字段 |
