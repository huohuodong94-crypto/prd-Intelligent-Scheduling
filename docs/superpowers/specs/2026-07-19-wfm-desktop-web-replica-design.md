# WFM 店铺经理桌面 Web 忠实复刻设计规格

**日期：** 2026-07-19

**状态：** 已确认设计范围，等待实施计划

**视觉与流程基准：** 由 `WFM_PPT_REFERENCE` 指向的经授权旧版视觉参考

**实施仓库：** `/Users/xanthe/Desktop/智能排班系统/WFM系统`

## 1. 目标

在现有 WFM 仓库内交付一套只面向桌面浏览器的店铺经理 Web 系统。系统忠实复刻原版操作手册中的信息结构、页面密度、表格、弹窗、排班网格、按钮语义和业务操作顺序，并与真实数据库、Next.js API 和 Python OR-Tools 排班引擎连接。

“忠实复刻”指：

- 原版 Web 截图中的视觉语言、页面层级、字段、按钮和操作顺序是实现基准。
- 原版 APP 功能转换为桌面 Web 页面，不保留手机外框、底部导航和触摸手势。
- 所有可操作控件必须连接真实 API；禁止用静态假数据或无效按钮伪装完成。
- 用户已明确调整的规则优先于 PPT：固定三班四小时、不做子部门、店长不进入排班、不做 DOM 审批。

## 2. 规格优先级

出现冲突时按以下顺序处理：

1. 本规格中的用户确认决策。
2. 经授权旧版视觉参考中的界面与业务流程。
3. 现有代码已经成立的技术架构和数据安全边界。
4. `docs/WFM系统二期改造PRD_v1.0.md` 中与前三项不冲突的内容。

## 3. 已锁定范围

### 3.1 必须实现

- 只提供桌面 Web，设计基准宽度 1440px，最低支持宽度 1280px。
- 店铺经理端作为主要工作台，保留 employee、manager、admin 三种现有角色。
- 固定三班四小时：早班 09:00–13:00、午班 13:00–17:00、晚班 17:00–21:00。
- 店长只负责管理，不作为排班员工，不占人力需求，不进入 DOM 审批。
- 门店营业状态与营业时间、V2S、最低人力、活动日历、员工标签。
- 工作区域、工作组及成员有效期。
- 排班计划、排班准备、业务预测、人力预测、自动排班、手动调整、发布。
- 班表模板下载、Excel 导入、校验、冲突检查、原子写入和失败明细。
- 复制历史、清空排班、恢复推荐、发布和导出。
- 待审批、审批记录、批量通过、批量驳回和 AI 合规建议。
- 打卡记录、日异常、补卡/请假联动、异常确认、月度确认和 Monthly 报表联动。
- 动态数字码的桌面展示和 Web 输入打卡，不提供手机 APP。
- AI 助手、AI 排班解释和 AI 交互反馈埋点沿用现有架构。

### 3.2 明确不做

- 手机端、APP、移动端响应式布局。
- Windows 或 macOS 原生安装客户端。
- 子部门及子部门独立负责人。
- 可编辑班次定义或第四种“全班”班次。
- 店长本人排班和 DOM 审批。
- 第三方企业身份登录、真实短信网关、总部十角色权限矩阵。
- 跨店调配和生产级机器学习客流预测。

## 4. 用户与权限

### employee

- 查看本人班表、工时和考勤结果。
- Web 输入动态数字码完成签到或签退。
- 发起年假、病假和补卡申请。
- 登记不可供班时段。
- 使用 AI 助手。

### manager

- 管理本店营业设置、V2S、最低人力、活动日历、工作区域、工作组和员工标签。
- 创建、调整、导入、复制、自动生成和发布本店班表。
- 审批本店请假、补卡和换班。
- 查询打卡、处理日异常、完成月度考勤确认。
- 查看本店报表和 AI 指标。

### admin

- 查看所有门店的配置、员工、报表和 AI 指标。
- 管理全局参数，但不得修改固定班次时间。
- 不代替店长完成门店日常排班审批。

所有 API 必须在服务端校验角色和 `storeId`，前端隐藏菜单不能替代服务端授权。

## 5. 桌面信息架构

### 5.1 全局框架

- 顶部 48px 一级模块栏：个人中心、劳动力管理、报表中心、系统管理。
- 左侧 208px 树形菜单，根据角色过滤。
- 内容区使用 16px 外边距，查询区、工具栏和数据区自上而下排列。
- 右上角展示门店、用户名、角色、消息入口和退出。
- 小于 1280px 时不压缩成手机布局，显示“请使用宽屏浏览器访问”的阻断提示。

### 5.2 路由

| 模块 | 路由 | 页面职责 |
|---|---|---|
| 首页 | `/dashboard` | 今日待办、待审批、排班缺口、考勤异常和门店概况 |
| 我的班表 | `/my-schedule` | 员工查看本人已发布班表和周工时 |
| Web 打卡 | `/attendance` | 员工输入动态数字码完成签到/签退并查看记录 |
| 我的申请 | `/leave` | 员工发起年假、病假和补卡并查看审批状态 |
| 动态码 | `/clock-code` | 经理端展示 6 位动态码和 60 秒倒计时 |
| 门店基础 | `/store/basic` | 门店信息、营业状态与周营业时间 |
| V2S | `/store/v2s` | 周一至周日 V2S 上下限 |
| 工作区域 | `/store/work-areas` | 区域新增、编辑、启停和员工关联 |
| 工作组 | `/store/work-groups` | 工作组、负责人、业务量类型和成员有效期 |
| 员工 | `/store/employees` | 岗位、能力、绩效、新老员工、工作区域和工作组 |
| 活动日历 | `/store/events` | 月视图、全年视图和活动标签 |
| 最低人力 | `/store/staffing` | 星期、班次、岗位维度的最低人数 |
| 排班计划 | `/schedule/plans` | 月历、计划列表和创建计划 |
| 排班向导 | `/schedule/plans/[id]` | 准备、业务预测、人力预测、自动排班四步 |
| 审批中心 | `/approvals` | 待审批、已审批、批量处理和 AI 建议 |
| 打卡记录 | `/attendance/punches` | 打卡查询、有效性与来源 |
| 日异常 | `/attendance/daily` | 异常查询、计算、处理、确认和批量操作 |
| 月汇总 | `/attendance/monthly` | 月度异常汇总、0 考勤和考勤确认 |
| 工时报表 | `/reports/monthly` | Monthly 工时表和确认状态 |
| 排班报表 | `/reports/scheduling` | 周工时、周班次、缺口、能力均衡和 V2S |

## 6. 视觉规格

### 6.1 色彩

- 顶部导航：`#122B49`
- 顶部激活态：`#1B3B5F`
- 主操作青蓝：`#149BC4`
- 主操作悬停：`#0E82A7`
- 页面背景：`#F3F5F7`
- 卡片/表格背景：`#FFFFFF`
- 表格表头：`#F7F9FB`
- 边框：`#DCE3EA`
- 主文字：`#273648`
- 次文字：`#6B7785`
- 成功：`#2F9E67`
- 警告：`#D98C22`
- 错误：`#D84A4A`

排班色块使用固定低饱和底色，文字保持深色：

- 早班：`#D8F0DD`
- 午班：`#FFF0BF`
- 晚班：`#FAD7CE`
- 请假：`#DCE7FA`
- 不可供班：`#ECEFF3`
- 缺口：`#F8C9C9`

### 6.2 字体与密度

- 中文正文优先使用系统无衬线字体：`PingFang SC`, `Microsoft YaHei`, sans-serif。
- 正文 13px，表格 12px，页面标题 18px，区块标题 14px。
- 行高 1.45；表格单行高度 36px；查询控件高度 32px；主按钮高度 32px。
- 不使用大圆角卡片、渐变背景、巨型数据卡或营销落地页式排版。
- 除状态标签和排班块外，圆角不超过 4px。

### 6.3 关键组件

- `AppShell`：顶部模块栏、左侧树形菜单、用户区和内容滚动区。
- `QueryBar`：组织、日期、状态、员工等高密度筛选。
- `EnterpriseTable`：固定表头、列宽、分页、行选择和批量操作。
- `ActionToolbar`：主操作、次操作、导入、导出和更多菜单。
- `Dialog` 与 `Drawer`：编辑少量字段用弹窗，查看复杂明细用抽屉。
- `StatusTag`：待处理、已通过、已驳回、已确认和异常类型。
- `ScheduleGrid`：员工行、日期列、指标行、彩色班次块、右键菜单和横向滚动。
- `MonthCalendar`：计划创建和活动日历。
- `ImportPanel`：模板下载、文件上传、校验进度和错误明细。
- `AsyncBoundary`：加载、空数据、权限错误和可重试失败。

## 7. 核心交互设计

### 7.1 门店配置

- 所有配置页采用“查询/门店选择 → 工具栏 → 数据表或日历”的原版结构。
- 普通编辑在弹窗中完成；保存成功后刷新当前数据，不整页跳转。
- V2S 和最低人力支持逐行编辑及批量保存。
- 活动日历点击日期应用当前标签，再次点击移除；全年视图只读总览。
- 工作组成员必须填写生效日期，结束日期可为空。

### 7.2 四步排班

1. **排班准备：** 选择做五休二或做六休一；确认营业状态；查看并维护不可供班。
2. **业务预测：** 展示每日三班客流预测；允许单格调整，调整原因必填并留痕。
3. **人力预测：** 根据 V2S 和最低人力折算岗位需求，只读；不满意必须返回业务预测调整。
4. **自动排班：** 输入自然语言偏好，LLM 解析软约束，OR-Tools 求解，展示结果、缺口和解释。

班表编辑规则：

- 左键打开班次编辑弹窗；右键显示编辑、复制、粘贴、清空。
- 复制和粘贴只作用于同一个计划周，粘贴前重新校验硬约束。
- “清空排班”二次确认；“恢复推荐”恢复最近一次引擎原始方案。
- 发布前再次执行硬约束检查；失败时定位到员工、日期和班次。
- 发布成功后员工端可见，并写入 AI 采纳率和编辑距离。

### 7.3 班表导入

- 下载模板包含员工工号、姓名、岗位、七天日期和合法班次名称对照。
- 上传后先解析，不立即写库。
- 校验员工所属门店、周范围、班次名称、重复记录、请假/不可供班、周工时和人力缺口。
- 页面展示“可导入、警告、错误”三类结果。
- 只有错误数为 0 时允许确认导入。
- 确认导入使用数据库事务；任意写入失败则整批回滚。

### 7.4 考勤异常

- 系统根据已发布班表、有效签到签退、请假和已批准补卡计算日结果。
- 日异常包括迟到、早退、缺签到、缺签退和未排班打卡。
- 经理可确认异常、取消确认、代提交请假/补卡并重新计算。
- 相同异常类型支持批量确认。
- 月度确认前必须检查该员工当月是否仍有未确认日异常。
- 月度确认后若班表、打卡、请假或补卡发生变化，自动撤销月度确认并要求重新计算。

## 8. 数据模型设计

保留现有 `Store`、`User`、`AttendanceRecord`、`LeaveRequest`、`Schedule`、`SchedulePlan`、`V2SConfig`、`MinStaffingConfig`、`StoreEvent`、`TrafficRecord`、`TrafficForecast`、`UnavailableSlot`、`PunchCorrection`、`ShiftSwapRequest`、`AiInteractionLog` 和 `RuleChunk`。

新增以下模型，并在 SQLite 与 PostgreSQL schema 中同步：

### StoreOperatingDay

- `storeId`
- `dayOfWeek`：0–6
- `isOpen`
- `openTime`：HH:mm
- `closeTime`：HH:mm
- 唯一键：`storeId + dayOfWeek`

### WorkArea

- `storeId`
- `name`
- `code`
- `active`
- 唯一键：`storeId + code`

### WorkGroup

- `storeId`
- `name`
- `leaderId`
- `volumeType`：traffic 或 delivery
- `active`
- 唯一键：`storeId + name`

### WorkGroupMember

- `workGroupId`
- `userId`
- `workAreaId`
- `effectiveFrom`
- `effectiveTo`
- 同一员工的有效期不得在同一工作组内重叠。

### ScheduleImportBatch

- `storeId`
- `planId`
- `fileName`
- `status`：validated、imported、failed
- `totalRows`
- `successRows`
- `errorRows`
- `errorsJson`
- `createdById`
- `createdAt`

### AttendanceExceptionConfirmation

- `storeId`
- `userId`
- `date`
- `type`：late、early_leave、missing_in、missing_out、unscheduled
- `status`：unconfirmed、confirmed
- `confirmedById`
- `confirmedAt`
- 唯一键：`userId + date + type`

### MonthlyAttendanceConfirmation

- `storeId`
- `userId`
- `month`：YYYY-MM
- `status`：unconfirmed、confirmed
- `zeroAttendanceAction`：none、normal_attendance、supplement_hours
- `confirmedById`
- `confirmedAt`
- 唯一键：`userId + month`

不新增 `ShiftDefinition` 和 `SubDepartment`，因为班次固定且用户已明确不做子部门。

## 9. API 与数据流

统一响应继续使用 `{ ok: true, data }` 和 `{ ok: false, error }`。请求与响应使用 Zod 定义并由前后端共享类型。

### 门店配置

- `GET/PUT /api/store/operating-days`
- `GET/POST/PUT/DELETE /api/store/work-areas`
- `GET/POST/PUT/DELETE /api/store/work-groups`
- `POST/DELETE /api/store/work-groups/members`
- 复用并扩展 `/api/demand`、V2S、最低人力和活动日历数据。

### 动态码

- `GET /api/clock-code`：经理获取当前码和过期时间。
- `POST /api/attendance/punch`：员工提交方向和数字码。
- 数字码由 `HMAC(storeId, floor(now / 60s), secret)` 派生，无需建表；验证当前和上一个时间窗。

### 排班

- 现有 `/api/schedule/plan`、`forecast`、`generate`、`save` 保持兼容。
- `POST /api/schedule/import/validate`
- `POST /api/schedule/import/commit`
- `POST /api/schedule/copy-history`
- `POST /api/schedule/publish`
- `POST /api/schedule/restore-recommendation`

数据流：门店配置和历史客流 → 业务预测 → V2S/最低人力折算 → 不可供班/请假/岗位/工时约束 → OR-Tools → 草稿班表 → 人工调整 → 发布 → 员工可见与 AI 埋点。

### 考勤

- `GET /api/attendance/punches`
- `GET /api/attendance/daily`
- `POST /api/attendance/daily/recalculate`
- `POST /api/attendance/daily/confirm`
- `POST /api/attendance/daily/unconfirm`
- `GET /api/attendance/monthly`
- `POST /api/attendance/monthly/confirm`
- `POST /api/attendance/monthly/unconfirm`

计算服务必须是独立纯函数模块，输入排班、打卡、请假和补卡，输出工时与异常；路由只负责授权、读取数据和持久化确认结果。

## 10. 错误与一致性

- 所有写入接口验证角色、门店归属和记录当前状态。
- 批量审批、班表发布和班表导入使用事务。
- 数据被其他操作修改时返回 409，并提示刷新后重试。
- 预测调整缺少原因返回字段级错误。
- 排班无可行解返回 422，并展示具体缺口和冲突，不退化为随机班表。
- 文件解析失败显示行号、列名、原值和修复建议。
- 月度确认存在未确认日异常时返回阻断员工清单。
- AI/优化引擎不可用时保留手动排班能力，但明确显示降级状态。

## 11. 实施边界与文件组织

不一次性重写整个 `src/app`。按业务纵向模块逐步迁移：

- `src/features/store/*`
- `src/features/scheduling/*`
- `src/features/approvals/*`
- `src/features/attendance/*`
- `src/features/reports/*`
- `src/components/enterprise/*`
- `src/lib/contracts/*`

每个 feature 包含页面组件、客户端请求、类型、纯业务函数和测试；数据库访问仍位于服务端路由或服务模块。现有路由在对应新页面通过验收后再替换，确保每个阶段仓库始终可运行。

## 12. 测试策略

### 单元与契约测试

- 为班表导入解析、考勤计算、权限、日期和约束映射编写 Vitest 测试。
- 新 API 先写失败测试，再实现路由和服务。
- SQLite 测试数据库验证事务、唯一键和跨门店隔离。

### 组件测试

- React Testing Library 覆盖查询、表格选择、弹窗、右键菜单、错误和空状态。
- `ScheduleGrid` 覆盖编辑、复制、粘贴、清空、恢复推荐和发布前校验。

### 端到端测试

- Playwright 覆盖经理登录 → 门店配置 → 创建计划 → 四步排班 → 发布。
- 覆盖员工打卡/请假 → 经理审批 → 考勤重算 → 日异常确认 → 月度确认 → 报表。
- 覆盖 Excel 模板下载、成功导入、错误导入和事务回滚。

### 视觉回归

- 从 PPT 提取的原版截图作为人工基准图。
- 固定在 1440×900 和 1366×768 两个桌面视口截图。
- 检查导航、表格列、弹窗、排班色块、间距、字体密度和滚动行为。
- 不以像素覆盖原截图为唯一标准；移动页面转 Web 后以信息、操作顺序和视觉语言一致为验收标准。

## 13. 分阶段交付

1. 全局框架、登录和企业组件。
2. 门店营业、V2S、最低人力、活动日历、工作区域和工作组。
3. 排班计划和四步向导。
4. 班表编辑、导入、复制、恢复和发布。
5. 审批中心和 AI 合规建议。
6. 打卡、日异常、补卡联动和月度确认。
7. Monthly、排班报表和 AI 指标。
8. 全链路回归、视觉对照、可访问性和性能检查。

每阶段都必须包含数据库/API、前端、自动化测试和真实浏览器验收，禁止先堆完全部页面再补后端。

## 14. 完成标准

- 所有列入范围的 PPT 经理端功能都有桌面 Web 对应页面。
- 所有页面使用真实 API，刷新后数据仍存在。
- 固定三班四小时在前端、API 和 OR-Tools 中保持一致。
- 店长不出现在排班员工集合中，也不存在 DOM 审批入口。
- 工作区域、工作组、班表导入和考勤确认形成完整前后端闭环。
- 排班发布、批量审批、导入和考勤确认具备事务与并发保护。
- 自动化测试、类型检查、构建和关键 Playwright 流程通过。
- 两个桌面基准视口与 PPT 视觉语言一致，没有移动端页面或无效操作。
