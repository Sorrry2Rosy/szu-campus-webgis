# WebGIS 报修渠道推荐与服务指南：后端任务书

版本：V0.1  
编制日期：2026-11-19  
适用阶段：课程教学原型的报修渠道扩展  
执行对象：后端开发成员，或在现有仓库中工作的编程 AI

## 1. 任务目标

在现有 FastAPI + PostgreSQL 后端中增加服务分类、服务片区和报修渠道数据能力，为前端“报修服务指南”和“地图选点推荐渠道”提供接口。

最小业务流程：

```text
用户选择服务类别、校区，提供地图选点或手选片区
    ↓
后端识别片区，或采用用户手选的有效片区
    ↓
查询同校区、同类别、同片区的渠道
    ↓
没有合适渠道时，查询明确覆盖该校区的通用渠道
    ↓
返回候选渠道、匹配依据、资料核实状态和教学登记能力
```

本任务只实现渠道目录和推荐。平台登记、推荐渠道、真实派单必须区分；不调用学校、物业或运营商的外部派单接口。

本文件是实施任务说明，表和接口均为待开发设计，不表示已落地。

## 2. 工作位置和现有基础

项目根目录：

```text
C:\Users\Lenovo\Desktop\大三上\GIS网络开发\深圳大学WebGIS项目文档
```

后端目录为根目录下的 `ldz-backend`，前端为 `WebGis`。下文代码路径均相对后端目录。

环境：Windows 11 + PowerShell。命令、脚本和 README 示例必须适用于 PowerShell。

实际技术栈：Python、FastAPI、Pydantic、psycopg、PostgreSQL；已有 PyProj 测地线距离计算。早期 Word 文档中的 SQLite 不是当前实际实现。

现有关键文件：

| 文件 | 当前职责 |
|---|---|
| `app/main.py` | 应用入口、CORS、异常响应和启动初始化 |
| `app/db.py` | 业务库与账户库连接、建表、建筑名称补充数据初始化 |
| `app/schema.sql` | 工单、设施、建筑名称补充和种子导入记录表 |
| `app/models.py` | 工单、设施、统计和账户模型 |
| `app/api.py` | 工单 CRUD、附近查重、设施、统计、建筑名称补充接口 |
| `app/spatial.py` | 20 米附近查重的测地线距离计算 |
| `app/auth.py`、`app/accounts.sql` | 独立账户接口与账户库表结构 |
| `app/init_db.py` | 初始化与原有模拟工单导入 |
| `tests/test_api.py` | PostgreSQL 接口集成测试 |

数据库配置使用 `CAMPUS_DB_DSN`、`CAMPUS_ACCOUNTS_DSN`。文档、提交和样例文件中不得包含真实连接密码。

### 必须兼容的现有行为

- 原有 `category=light / road / facility` 和历史工单继续有效。
- 工单状态继续按 `pending → processing → resolved` 流转。
- 删除操作仍只允许删除模拟工单。
- 现有 20 米同类未解决工单查重规则、返回结构和米制距离算法保持兼容。
- 现有统计接口、设施接口、账户接口和建筑名称补充数据初始化继续可用。
- 不要求前端先增加新字段，旧版工单 POST / PATCH 仍可成功。
- 不把当前账户接口扩展误写成已具备完整管理员授权。

## 3. 范围与交付阶段

### P0：本轮必须实现

1. 服务分类、服务片区和报修渠道的数据表、模型及初始化。
2. 分类列表、片区列表、渠道列表与详情查询。
3. 地图选点识别片区与手选片区查询。
4. 同片区匹配、同校区通用渠道回退及无结果处理。
5. 教学样例与正式渠道的隔离。
6. 幂等初始化、原有功能回归、接口文档与联调说明。

### P1：P0 验收后再实施

为工单增加可空服务分类与渠道关联字段，并允许创建工单时提交关联。P0 不依赖这一步完成。

### 本轮不实现

真实派单、部门人员账号体系、维修人员管理、公开渠道编辑后台、外部工单同步、短信通知、照片上传、GIS 热力图和建筑统计。后三类空间分析可安排为下一任务，优先于复杂人员分派。

## 4. 初始服务分类

新字段名称统一为 `service_category`。原有工单 `category` 继续承担兼容性粗分类，不直接改名。

| code | name | 内容与边界 | legacy_issue_category |
|---|---|---|---|
| campus_lighting | 校园公共照明 | 公共道路路灯；室内灯具归水电维修 | light |
| campus_road | 道路及附属设施 | 路面及道路附属设施；排水堵塞归水电维修 | road |
| public_facility | 公共服务设施 | 公共座椅、垃圾箱等；专门类别优先 | facility |
| dorm_property | 宿舍设备与物业 | 门锁、家具、空调、热水器；供水供电与网络故障使用各自类别 | facility |
| water_electric | 水电及排水 | 漏水、跳闸、管道堵塞、室内灯具；按片区继续区分渠道 | facility |
| campus_network | 网络服务 | 宿舍、教学办公网络；可能需要网络类型或运营商信息 | facility |
| teaching_equipment | 教学多媒体设备 | 投影仪、教学电脑、话筒等 | facility |

不要根据自然语言故障描述自动猜类别。本轮由用户选择标准类别。

## 5. 片区数据和空间边界

现有前端数据位于 `WebGis/data`：

- `funct_area.geojson`：7 个功能分区多边形。
- `detail_area.geojson`：粤海、沧海两个校区边界。
- `building_area.geojson`：建筑面。

功能分区编码草案：

| zone_code | name | source_feature_id | zone_type |
|---|---|---:|---|
| dorm_006 | 学生宿舍分区 006 | 6 | dorm |
| teaching_007 | 教学科研分区 007 | 7 | teaching |
| dorm_010 | 学生宿舍分区 010 | 10 | dorm |
| sports_013 | 体育运动分区 013 | 13 | sports |
| dorm_014 | 学生宿舍分区 014 | 14 | dorm |
| sports_015 | 体育运动分区 015 | 15 | sports |
| teaching_017 | 教学科研分区 017 | 17 | teaching |

这些是原始功能分区，不等于经过校方确认的物业服务片区。不擅自把任何编号改称“西南宿舍片区”。

校区代码采用 `yuehai`、`canghai`，来自现有校区边界名称。当前主要业务范围仍为粤海；不得跨校区返回通用渠道。

导入要求：

1. 按原始 `ID` 映射，不能按 GeoJSON 数组序号映射。
2. 将后端所需数据复制到后端自己的数据目录，保留来源说明；运行时不依赖前端目录的相对位置。
3. 核对功能区与校区边界关系。跨界、重叠或坐标含义不明确的记录保持停用，输出问题清单，不静默归属。
4. 原坐标存在历史纠偏处理，需要记录核对结果；本任务不再次自动执行 GCJ-02/WGS84 纠偏。
5. 区分“可供教学空间识别”与“已确认真实服务范围”。教学启用不代表真实范围已核实。
6. 所有 GeoJSON 坐标顺序为 `[longitude, latitude]`，与 Leaflet 常用参数顺序区分。

`all_campus` 为当前校区通用渠道的逻辑范围，不是空间多边形，不参与点面识别。

## 6. 数据表设计要求

使用现有 PostgreSQL 业务库，不修改账户库。不强制安装 PostGIS。小规模数据可采用 JSONB 保存 GeoJSON，使用 Shapely 做点面判断；如新增依赖，固定兼容版本并记录用途。

### 6.1 service_categories

| 字段 | 建议类型 | 约束或用途 |
|---|---|---|
| code | TEXT | 主键，稳定的服务分类编码 |
| name | TEXT | 非空中文名称 |
| description | TEXT | 受理内容 |
| exclusions | TEXT | 分类边界 |
| legacy_issue_category | TEXT | light / road / facility |
| sort_order | INTEGER | 展示顺序 |
| is_enabled | BOOLEAN | 是否可供用户选择 |

### 6.2 campus_scopes

保存 `yuehai`、`canghai` 的代码、名称、边界 GeoJSON、数据来源、核对说明和启用状态。校区边界是教学空间判断依据，不代表部门正式服务范围。

### 6.3 service_zones

| 字段 | 建议类型 | 约束或用途 |
|---|---|---|
| code | TEXT | 主键；本版7个实际分区编码全局唯一 |
| name | TEXT | 展示名称 |
| campus_code | TEXT NULL | 外键到 campus_scopes；草稿可空，启用前必须明确 |
| zone_type | TEXT | dorm / teaching / sports |
| source_feature_id | INTEGER | 原始功能分区ID |
| geometry | JSONB | Polygon 或 MultiPolygon |
| scope_status | TEXT | unverified / verified / expired |
| source_note | TEXT | 来源、教学性质和范围说明 |
| is_mock | BOOLEAN | 是否为教学分区用途 |
| is_enabled | BOOLEAN | 是否参与本模式下的识别 |

不得将仅有几何校验的分区标记为业务范围已核实。启用分区必须同时具备有效几何和明确校区。

### 6.4 repair_routes

| 字段 | 建议类型 | 约束或用途 |
|---|---|---|
| id | BIGINT IDENTITY | 主键 |
| code | TEXT UNIQUE | 种子数据与文档使用的稳定编码 |
| service_category | TEXT | 外键到 service_categories.code |
| campus_code | TEXT NULL | 外键；停用草稿可空，启用前必须明确 |
| scope_kind | TEXT | zone / campus |
| zone_code | TEXT NULL | 实际分区外键；campus 范围为空 |
| name | TEXT | 渠道展示名称 |
| department_name | TEXT NULL | 已知部门名称或明确的教学模拟名称 |
| phone | TEXT NULL | 字符串，不得使用整数类型 |
| online_url | TEXT NULL | 真实 http/https 入口 |
| online_channel_note | TEXT NULL | 公众号等文字说明 |
| service_area | TEXT | 面向用户的服务范围说明，不参与字符串模糊匹配 |
| service_hours | TEXT NULL | 未知时为空 |
| supports_platform_ticket | BOOLEAN | 支持本平台教学登记，不表示真实派单 |
| required_context | JSONB | 字符串数组，如 network_type、operator；默认 [] |
| verification_status | TEXT | unverified / verified / expired |
| source_url | TEXT NULL | 官方依据；未核实可空 |
| verified_at | TIMESTAMPTZ NULL | 最近核实时间 |
| is_mock | BOOLEAN | 是否教学样例 |
| is_enabled | BOOLEAN | 是否启用 |
| created_at / updated_at | TIMESTAMPTZ | 审核与维护时间 |

实现决策：数据库通过 `scope_kind=campus + zone_code=NULL` 表示通用渠道；API 将其 `zone_code` 输出为 `all_campus`。这样实际分区仍可使用外键，避免虚构多边形。请求参数 `zone_code=all_campus` 同样转换为上述条件。

约束：zone 范围必须有 zone_code，campus 范围必须为空；渠道校区必须与实际分区校区一致；同类别同片区允许多条渠道。为校区、分类、范围和启用状态的组合查询建立适当索引。

## 7. 教学样例与正式查询隔离

新增服务器配置 `CAMPUS_REPAIR_DEMO_MODE`，默认 false；不得通过公开查询参数打开教学模式。

- 普通模式只返回已启用、非模拟、已核实且有核实来源及日期的渠道，排除过期记录。
- 教学模式可额外返回已启用的模拟渠道及模拟分区，必须携带 is_mock 和资料状态；真实但未核实渠道仍不作为有效推荐。
- 停用、无所属校区的草稿不进入公共查询与推荐。
- 原始样例默认停用，电话、未知部门、时间、URL 使用 null。不得补造真实号码或链接。
- 不在应用每次启动时自动把模拟记录启用。提供显式、幂等的本地导入/教学启用命令。
- 对外不提供任意读取草稿或编辑渠道的接口；P0 的维护通过受控导入完成。

首批样例：

| code | service_category | scope_kind | zone_code（API） | supports_platform_ticket |
|---|---|---|---|---|
| demo_dorm_006_property | dorm_property | zone | dorm_006 | false |
| demo_teaching_007_equipment | teaching_equipment | zone | teaching_007 | false |
| demo_campus_lighting | campus_lighting | campus | all_campus | true |
| demo_campus_network | campus_network | campus | all_campus | false |

样例 campus_code 初始可为空，is_mock=true、is_enabled=false、verification_status=unverified。实际教学启用前，明确所属校区及范围；网络样例可标记 required_context=["network_type","operator"]。

## 8. 新增只读接口契约

统一前缀 `/api`，返回 JSON。建议独立路由模块并复用现有数据库依赖与异常格式。

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | /api/service-categories | 启用的服务分类 |
| GET | /api/service-zones | 当前模式可用的片区；campus_code 必填 |
| GET | /api/repair-routes | 服务指南渠道列表，可按类别和校区筛选 |
| GET | /api/repair-routes/match | 选点或手选片区的渠道推荐 |
| GET | /api/repair-routes/{id} | 当前模式可见的渠道详情 |

静态 `/match` 必须先于动态 `/{id}` 注册。

列表统一为 `{"items": [...], "count": 0}`，使用固定排序。片区列表默认不输出完整 geometry；响应中说明 all_campus 是逻辑范围。渠道详情或列表输出显示字段、核实信息、required_context、is_mock 和教学登记能力。

渠道列表筛选约定：campus_code、service_category 均为可选精确筛选；可选 zone_code 必须同时提供 campus_code，只筛选该范围，不自动回退。只有 match 接口执行回退。编码合法但资源不存在返回 404；格式错误返回 422。当前模式不可见的详情也返回 404。

### 8.1 推荐请求

```http
GET /api/repair-routes/match?campus_code=yuehai&service_category=campus_lighting&lng=113.9301&lat=22.5325
```

参数：

| 参数 | 必填 | 规则 |
|---|---|---|
| campus_code | 是 | 有效启用校区代码 |
| service_category | 是 | 有效启用服务类别 |
| lng、lat | 否 | 必须成对提供；有限数值与合法经纬度范围 |
| zone_code | 否 | 手选实际片区或 all_campus；实际片区必须属于所选校区且当前模式可用 |

没有坐标也没有手选片区时，只查该校区通用渠道。手选片区优先，响应标记 selection_source=manual；只有空间识别时为 spatial；只查询通用范围时为 general。

### 8.2 匹配步骤与确定性

1. 校验校区、服务类别、参数及其启用状态。
2. 有坐标时先检查所选校区边界。校区外或恰好在校区边界上，返回需要用户确认的业务结果，不自动跨校区或回退。
3. 有合法手选片区时采用用户选择，保留手选来源。坐标与片区不一致时附带 manual_zone_differs 提示，不静默改写手选结果。
4. 没有手选片区时，对选定校区内的可用实际分区做点面判断。内部命中唯一分区可采用；边界命中或命中多个分区要求手选；零命中表示功能区未覆盖，可尝试当前校区通用渠道。
5. 在当前模式下，按校区、类别、实际片区查询有效候选。
6. 没有任何有效片区候选时，才回退到同校区、同类别的通用候选；片区已有候选但缺少必要上下文时，不绕过条件回退。
7. 如果候选 required_context 非空，本轮返回 needs_context 和待补充字段，不把它标记成已确定的渠道。运营商等复杂上下文的自动匹配留给下一版本。
8. 返回所有符合条件的候选，按 code、id 稳定排序，不强制选一个。

几何处理：验证 Polygon/MultiPolygon 和坐标范围，不静默修复无效几何；使用包含关系与边界判断，不用包围盒代替实际多边形判断。不得用地图缩放级别或屏幕像素判定片区。

### 8.3 推荐成功示例

以下仅为教学模式测试夹具，不代表当前真实渠道或既有几何命中结果。

```json
{
  "campus_code": "yuehai",
  "service_category": "campus_lighting",
  "selection_source": "spatial",
  "resolved_zone": {"code": "teaching_007", "name": "教学科研分区 007", "is_mock": true},
  "zone_candidates": [],
  "match_level": "campus_fallback",
  "decision": "matched",
  "reason": "no_zone_route",
  "warnings": [],
  "missing_context": [],
  "items": [
    {
      "id": 3,
      "code": "demo_campus_lighting",
      "name": "公共照明教学登记",
      "campus_code": "yuehai",
      "service_category": "campus_lighting",
      "zone_code": "all_campus",
      "department_name": "教学模拟公共设施组",
      "phone": null,
      "online_url": null,
      "online_channel_note": "在本平台登记教学模拟工单",
      "service_area": "已明确的教学演示校区范围",
      "service_hours": null,
      "supports_platform_ticket": true,
      "required_context": [],
      "verification_status": "unverified",
      "source_url": null,
      "verified_at": null,
      "is_mock": true
    }
  ],
  "count": 1
}
```

输出枚举固定为：

- decision：matched / no_match / needs_zone_selection / needs_campus_confirmation / needs_context。
- match_level：zone / campus_fallback / none。needs_context 可保留候选所属匹配层级，其 items 是待确认候选。
- reason：exact_zone / general_requested / no_zone_route / no_zone_geometry / no_eligible_route / ambiguous_zone / zone_boundary / outside_campus / campus_boundary / context_required。
- resolved_zone：未识别、待选或通用查询时可为空；需要选择时 zone_candidates 返回可选实际分区。
- 无结果和需要进一步确认的业务状态返回 HTTP 200，items/count 与实际返回列表一致；不要把这些状态伪装成数据库错误。
- 边界或片区歧义响应不得直接返回已推荐渠道。outside_campus 不返回其他校区的联系人。

缺失或非法参数返回 422；未知资源返回 404；数据库不可用沿用 503。不得泄露连接字符串或 SQL 详情。

## 9. P1 工单关联规则

P0 交付后单独实施；不要在 P0 为赶进度偷偷改造旧工单契约。

1. issues 增加可空 service_category、repair_route_id，旧工单保持为空；不根据历史标题猜测回填。
2. 更新 IssueCreate、Issue 响应模型和 INSERT 字段，旧请求省略新字段时继续成功。
3. 新分类与旧 category 同时提供时，校验分类表中的粗分类映射，不一致返回 422。
4. 关联渠道必须属于对应服务分类、有效校区与允许范围，并支持当前平台登记；不得接受不存在、不可见、停用或上下文未确认的渠道。
5. 模拟渠道只允许关联 is_mock=true 的模拟工单，客户端不能通过修改 is_mock 绕过校验。
6. 正式界面仍须说明当前仅为教学登记。不要将登记成功标记成已送达真实部门。
7. 渠道采用停用维护，不向前端开放硬删除；历史工单仍能保留原关联。以后如做渠道删除，明确外键和历史展示策略。
8. P1 暂不通过普通工单 PATCH 改渠道；原状态/描述/备注更新继续可用。分类改变且已有渠道时，必须重新校验关联一致性。
9. 首版 20 米查重继续使用旧 category 规则；细分类查重如需调整，另行设计并说明对历史数据的影响。

## 10. 迁移、初始化和代码组织

- 现有 CREATE TABLE IF NOT EXISTS 不会升级已有表结构。新增字段必须通过显式、幂等迁移实现，不清库重建。
- 为新安装保留完整 schema，同时提供已有业务库升级路径。多次执行不会重复种子数据或覆盖人工修订内容。
- 保留现有 initialize 中的建筑名称补充导入；新种子使用独立稳定 code 和版本记录。
- 新增逻辑集中在后端，如 app/repair_api.py、app/repair_models.py、app/repair_service.py；点面识别可单独模块，避免覆盖已有距离查重函数。
- 建议提供 app/data/repair_catalog/：分类、分区草稿、校区边界、渠道样例及来源说明。
- 普通启动不覆盖数据，不自动启用渠道。导入与启用分别提供明确的本地命令。
- 迁移尽量事务化；提供执行前备份、失败恢复说明。恢复时优先停用新模块，避免通过删表删除已关联数据。
- 复用原 CORS 配置，确认前端 5500 端口可以读取新增 GET 接口。
- 本任务书不要求修改三个现有 Word 文档，也不要求重构前端。

## 11. 验收案例

使用专用测试库、独立测试 schema 和人工可判定的几何夹具。不要修改真实工单，不能仅以“测试被跳过”作为通过证据。

| 编号 | 场景 | 期望 |
|---|---|---|
| T01 | 旧库升级；初始化/种子执行两次 | 原数据保留；无重复和意外覆盖 |
| T02 | 旧版五字段新增工单、修改状态、删除模拟工单 | 原行为保持；原有集成测试继续通过 |
| T03 | 查询分类 | 7类编码、名称、排序、粗分类映射正确 |
| T04 | 校区内部点唯一命中分区，存在片区渠道 | zone 匹配；返回正确来源 |
| T05 | 分区无有效渠道，但同校区存在通用渠道 | campus_fallback；不跨校区 |
| T06 | 所有实际分区之外、校区之内的点 | resolved_zone 为空；只尝试本校区通用渠道 |
| T07 | 校区外点或校区边界点 | 需要校区确认；不推荐渠道 |
| T08 | 分区边界、多个分区重叠 | 需要手选，返回候选；结果不依赖导入顺序 |
| T09 | 手选有效片区；手选片区与坐标不一致 | 手选优先且有来源/提示；跨校区手选拒绝 |
| T10 | 停用、未核实真实渠道、过期渠道、无校区草稿 | 不进入有效推荐 |
| T11 | 普通模式与教学模式 | 普通模式不返回样例；教学模式明确标识模拟 |
| T12 | 同片区同类别多渠道 | 全部稳定返回；count 正确 |
| T13 | 缺一个坐标、NaN、无效代码、错误坐标范围 | 422；未知合法资源返回404 |
| T14 | required_context 非空 | needs_context；不猜运营商，不绕过条件回退 |
| T15 | /match 静态路由、详情可见性、CORS、数据库断连 | 无路径冲突；不可见详情404；数据库错误503 |
| T16 | Polygon孔洞、MultiPolygon、无效几何导入 | 判断正确；无效几何拒绝导入或保持停用并报告 |
| T17 | P1 不存在/不支持/跨范围/模拟渠道关联 | 拒绝错误关联；旧工单新字段保持为空 |

现有功能分区和校区归属未核实的部分可以以停用草稿交付，但必须列出未解决项目；用测试夹具证明算法和接口功能，不能虚构真实渠道来填补数据缺口。

## 12. 交付清单与建议顺序

执行顺序：数据契约 → 幂等迁移 → 草稿导入 → 目录接口 → 空间识别与推荐 → 回归验证 → 联调文档；P1 另做一阶段。

交付时提供：

- [ ] 数据表、模型和兼容迁移；已有库与新库均可初始化。
- [ ] 7类服务分类、7个分区草稿、2个校区边界及4条停用渠道样例。
- [ ] 数据来源说明、几何核对结果和待核实清单。
- [ ] 五个新增只读接口及 OpenAPI 描述。
- [ ] 点面识别、边界歧义、手选覆盖、通用渠道回退实现。
- [ ] 模式隔离与资料核实过滤。
- [ ] PowerShell 初始化、导入、教学启用、启动和测试命令；参数使用占位符，不保存密码。
- [ ] README 联调示例：匹配成功、无结果、需要手选、需要补充上下文。
- [ ] 实际测试结果，明确通过、失败、跳过和未验证部分。
- [ ] P0/P1 完成范围，以及前端下一步需要读取的字段清单。

完成判据：前端可通过新增接口展示服务指南，并根据手选片区或地图选点获得可解释的渠道候选；没有可靠数据时正确返回无结果或待确认状态；现有工单流程保持可用。
