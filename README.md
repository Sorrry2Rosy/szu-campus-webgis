# 深圳大学校园设施巡检与报修 WebGIS

基于深圳大学校园空间数据的 GIS 网络开发课程项目。通过地图选点、教学工单登记、工单管理、20 米附近重复问题检测和统计图表，演示校园设施问题的上报与处置流程。

本项目为课程教学原型。模拟工单与设施不代表学校真实维修事件；当前没有接入学校、物业或运营商的正式派单系统。

## 技术栈

- 前端：原生 HTML / CSS / JavaScript、Leaflet、MarkerCluster、Bootstrap、ECharts。
- 后端：Python、FastAPI、Pydantic、psycopg。
- 数据库：PostgreSQL，业务库与账户库分开。
- GIS：GeoJSON、Shapefile、PyProj 测地线距离计算。

## 当前功能

- 校园建筑、道路、绿地、水面、边界、功能区、附属设施和地名图层。
- 图层开关、属性弹窗、地图选点、比例尺和公共设施查询。
- 教学工单创建、地图聚合、状态展示与筛选。
- 独立工单管理页：搜索、筛选、编辑描述及备注、顺序推进状态、删除模拟工单、地图定位。
- 提交前检测 20 米内同类未解决工单，允许确认后继续提交。
- 工单数量卡片、状态/类别分布、类别对比和近期上报趋势图。
- 后端账户注册、登录、会话查询和退出接口；完整前端登录与角色权限管理尚未完成。

以上按当前源码整理；本次入库未重新执行完整业务验收。

## 目录

```text
WebGis/              前端页面、脚本、样式与 GeoJSON
ldz-backend/         后端、数据库结构与测试
实验数据（深大）/    原始校园 GIS 实验数据
docs/                后续开发任务书
01_项目介绍与设计说明.docx
02_资料收集清单.docx
03_成员分工说明.docx
```

原始空间资料的授权、来源和坐标处理说明需要进一步整理。仓库未为第三方数据或依赖另行授予许可。Leaflet / Bootstrap / MarkerCluster 和底图依赖网络资源，ECharts 文件保存在前端 vendor 目录。

## 本地运行（Windows + PowerShell）

先安装 Python 与 PostgreSQL。新克隆的项目不含虚拟环境和数据库内容。

在仓库根目录执行：

```powershell
Set-Location .\ldz-backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

按照 [后端说明](ldz-backend/README.md) 建立应用角色、业务库 `campus_webgis` 和账户库 `campus_accounts`。旧说明中的绝对路径属于开发者原环境，需替换为自己的克隆位置。早期 Word 方案中的 SQLite 已被当前 PostgreSQL 实现替代。

两个数据库就绪后，在同一个 PowerShell 窗口设置连接。以下使用默认应用角色 `campus_app`；密码在本机隐藏输入，不写入文件：

```powershell
$campusSecret = Read-Host '请输入 campus_app 数据库密码' -AsSecureString
$campusEncoded = [uri]::EscapeDataString([System.Net.NetworkCredential]::new('', $campusSecret).Password)
$env:CAMPUS_DB_DSN = "postgresql://campus_app:${campusEncoded}@127.0.0.1:5432/campus_webgis"
$env:CAMPUS_ACCOUNTS_DSN = "postgresql://campus_app:${campusEncoded}@127.0.0.1:5432/campus_accounts"
Remove-Variable campusSecret,campusEncoded
.\.venv\Scripts\python.exe -m app.init_db --demo
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

`--demo` 为新数据库导入基础模拟设施和工单，重复执行不会重复导入；不指定则仅初始化。现有开发数据库中的工单、账户和会话没有随 Git 上传。

新开一个 PowerShell 窗口，在仓库根目录运行前端：

```powershell
Set-Location .\WebGis
python -m http.server 5500 --bind 127.0.0.1
```

- 地图：[http://127.0.0.1:5500/index.html](http://127.0.0.1:5500/index.html)
- 工单管理：[http://127.0.0.1:5500/issues.html](http://127.0.0.1:5500/issues.html)
- API 文档：[http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
- 健康检查：[http://127.0.0.1:8000/api/health](http://127.0.0.1:8000/api/health)

前端默认请求 `http://127.0.0.1:8000`。后端默认允许 localhost / 127.0.0.1 的 5500 和 5173 来源。勿直接双击 HTML 用 file:// 访问，否则本地 GeoJSON 请求可能受限制。

## 测试

测试需要两个专用 PostgreSQL 测试库，及 `CAMPUS_TEST_DB_DSN`、`CAMPUS_TEST_ACCOUNTS_DSN`。具体建库和设置方式见后端 README。在后端目录执行：

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

未配置测试库时用例会跳过，跳过不代表通过。

## 下一阶段

[报修渠道推荐与服务指南后端任务书](docs/WebGIS_报修渠道推荐_后端任务书.md) 规定了分类、服务片区、渠道数据、点面识别和推荐接口的待开发工作。任务书不代表这些扩展功能已经实现。真实渠道的电话、部门和服务范围需要核实后再启用。
