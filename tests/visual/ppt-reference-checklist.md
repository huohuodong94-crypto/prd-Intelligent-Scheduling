# WFM 桌面 Web PPT 视觉参考审查清单

本清单记录 Task 10 的正式人工视觉验收。独立 reviewer `T10-VR` 已实际查看 Web actual、PPT 参考页与修复后重跑图，并于 `2026-07-19` 审签 18 个 case。正式 Web 基线来自 `/private/tmp/wfm-task10-phaseb-final-rereview-WuCub3/generated-unaccepted-snapshots-full/`：18 张候选图逐文件通过 `SHA256SUMS`，与同目录 `actual/*-actual.png` 逐字节一致，复制后与仓库基线再次逐字节一致；接受过程未使用 `--update-snapshots`。

## 0. 证据准备与入口门禁

- [x] 从仓库根目录运行 `python3 scripts/extract-ppt-reference.py`。
- [x] `test-results/ppt-reference/` 中只有 `slide-001.png` 至 `slide-063.png` 共 63 张参考图；不存在缺页、重复页或旧图。
- [x] 正式提取使用 Keynote，抽检页中文清晰可辨；LibreOffice 诊断 fallback 的缺少 CJK 字体、缺少所需字形和静默替代拒绝逻辑由提取脚本单测覆盖。
- [x] Slides 13/15/52 的标题可区分且 PNG 哈希不碰撞：分别为“店长审批”“门店信息”“异常处理”。
- [x] Slides 32/55/59/63 的中文标题与主要说明清晰可辨；Slide 63 显示“到此结束，谢谢！”，未出现 CJK 空心方框。
- [x] `git check-ignore test-results/ppt-reference/slide-001.png` 成功，且源 PPT 未复制或提交到 Git。
- [x] 源文件路径仅通过 `WFM_PPT_REFERENCE` 环境变量传入；源文件未复制或提交到 Git。
- [x] 数据库、浏览器时间、服务端时间、locale 与 timezone 已按 Task 10 固定；两种视口使用相同业务数据和查询日期。
- [x] 页面已完成明确就绪门禁，不是在 loading、旧查询、空白闪烁或未关闭弹层状态。
- [x] 18 张 Web actual 已完成独立视觉审查和两轮真实的“发现问题 → 修复 → 重新核验”，满足接受基线的人工审查门禁。

冲突裁决顺序：已批准规格与硬边界 → Tasks 1–9 已验收业务语义/权限 → PPT 桌面页面结构、密度、颜色与层级 → 当前实现局部装饰。PPT 的讲义边框、红色手指/序号、水印、旧品牌不是产品 UI。

## 1. 18 个路由/视口审查记录

填写规则：reviewer 填写姓名或 initials；日期使用 `YYYY-MM-DD`；实际审查后把结果替换为 `PASS` 或 `FAIL`。若为 `FAIL`，必须在“问题与复验记录”中写明可复现问题、修复提交和复验 case。

| # | Route | Viewport | PPT 证据 | 截图前就绪门禁 | Reviewer | 日期 | 结果 |
|---:|---|---|---|---|---|---|---|
| 01 | `/dashboard` | `1440×900` | Slides 32、53、54、60、62 | `门店工作台`、pending approvals、报表快捷入口均可见 | T10-VR | 2026-07-19 | PASS |
| 02 | `/dashboard` | `1366×768` | Slides 32、53、54、60、62 | 与 case 01 相同，核心指标首屏可见 | T10-VR | 2026-07-19 | PASS |
| 03 | `/store/basic` | `1440×900` | Slides 16、18 | `门店基础与营业日`、固定班次只读、营业日表头可见 | T10-VR | 2026-07-19 | PASS |
| 04 | `/store/basic` | `1366×768` | Slides 16、18 | 与 case 03 相同，星期/时间控件无截断 | T10-VR | 2026-07-19 | PASS |
| 05 | `/store/work-groups` | `1440×900` | Slides 20、23、24 | `工作组`、新增按钮、六列表头可见 | T10-VR | 2026-07-19 | PASS |
| 06 | `/store/work-groups` | `1366×768` | Slides 20、23、24 | 与 case 05 相同，操作列不换行漂移 | T10-VR | 2026-07-19 | PASS |
| 07 | `/schedule/plans` | `1440×900` | Slides 32–42、45、48、50–51 | 月份固定 `2026-07`，月历与种子计划列表稳定 | T10-VR | 2026-07-19 | PASS |
| 08 | `/schedule/plans` | `1366×768` | Slides 32–42、45、48、50–51 | 与 case 07 相同，日历/列表不覆盖 | T10-VR | 2026-07-19 | PASS |
| 09 | `/approvals` | `1440×900` | Slide 14（仅流程）；Slides 53、54、60（桌面结构） | `统一审批中心`、tablist、两条固定待审批 seed 与时间稳定 | T10-VR | 2026-07-19 | PASS |
| 10 | `/approvals` | `1366×768` | Slide 14（仅流程）；Slides 53、54、60（桌面结构） | 与 case 09 相同，不出现移动端画布 | T10-VR | 2026-07-19 | PASS |
| 11 | `/attendance/daily` | `1440×900` | Slides 54–58 | 固定日期，`日考勤异常` 表格或确定性空态稳定 | T10-VR | 2026-07-19 | PASS |
| 12 | `/attendance/daily` | `1366×768` | Slides 54–58 | 与 case 11 相同，工具栏动作不掉出视口 | T10-VR | 2026-07-19 | PASS |
| 13 | `/attendance/monthly` | `1440×900` | Slides 59–62 | 月份 `2026-07`，表格或 blocker 稳定 | T10-VR | 2026-07-19 | PASS |
| 14 | `/attendance/monthly` | `1366×768` | Slides 59–62 | 与 case 13 相同，确认工具栏和状态可见 | T10-VR | 2026-07-19 | PASS |
| 15 | `/reports/monthly` | `1440×900` | Slides 59、61、62 | 查询 `2026-07` 后，月度汇总与 named table 稳定 | T10-VR | 2026-07-19 | PASS |
| 16 | `/reports/monthly` | `1366×768` | Slides 59、61、62 | 与 case 15 相同，指标不挤掉明细首屏 | T10-VR | 2026-07-19 | PASS |
| 17 | `/reports/scheduling` | `1440×900` | Slides 38–40、44–46 | 查询周一 `2026-07-20` 后，AI 指标与员工表稳定 | T10-VR | 2026-07-19 | PASS |
| 18 | `/reports/scheduling` | `1366×768` | Slides 38–40、44–46 | 与 case 17 相同，V2S/缺口/能力表无页面级溢出 | T10-VR | 2026-07-19 | PASS |

## 2. 每个 case 都必须执行的全局检查

- [x] 48px 深色顶栏、208px 左侧菜单、16px 主内容内边距与当前激活态清晰。
- [x] 页面信息顺序为“标题 → 查询 → 操作 → 数据区”，保持企业后台紧凑密度，不出现营销 Hero 或移动卡片流。
- [x] `1366×768` 不隐藏业务列、不缩成不可读字体，`html/body/main` 无横向滚动；只允许表格/排班网格自身滚动。
- [x] 两视口的数据、月份/周一/日期和请求完成状态一致；无动画、光标、loading 或陈旧数据噪声。
- [x] 页面只含一个主 `h1`；表格/区域有 accessible name，状态有文字，不能只靠颜色表达。
- [x] 主按钮、链接和表单控件有明确 label 与可见 `:focus-visible`。
- [x] Dialog、Drawer、菜单在主态截图前关闭；行为审查已验证焦点进入、Tab 约束、Escape 关闭和焦点恢复。
- [x] AI 助手不遮挡末列、分页、滚动条或主要操作。
- [x] 对照对应 PPT 页只复核产品结构、密度、颜色和信息层级，未复制讲义装饰或旧品牌。
- [x] 未出现 APP/移动端、子部门、DOM、旧多班次、店长班表。

## 3. 分路由视觉与交互证据

### `/dashboard`

- [x] 深海军蓝一级模块栏、左侧功能树、浅灰内容背景和白色内容表面形成三段层级。
- [x] 四个指标卡和两个报表入口紧凑可扫读；不伪造 PPT 中不存在的 KPI 图。
- [x] 1366×768 首屏仍可看到核心指标，AI 按钮不遮挡入口。

### `/store/basic`

- [x] 顺序为门店查询 → 操作工具栏 → 固定班次摘要 → 七日营业表。
- [x] 七天营业状态、开闭店时间横向对齐；固定三班明确为只读。
- [x] 编辑门店 Dialog 为桌面居中两列表单，主动作位于右下且键盘可达。

### `/store/work-groups`

- [x] 顶部新增工具栏后紧接高密度工作组表，工作组/组长/业务量/成员/状态/操作同屏可见。
- [x] 新增/编辑使用居中 Dialog；成员有效期使用右侧 Drawer，底部动作不越出视口。
- [x] 状态使用克制颜色和明确文字；工作区域未演变为子部门。

### `/schedule/plans`、四步向导与排班网格

- [x] 月份说明与查询位于 42 格月历上方，月历之后是计划列表，二者不覆盖。
- [x] 四步固定为排班准备 → 业务预测 → 人力预测 → 自动排班，当前步骤不只靠颜色表示。
- [x] 自动排班先显示指标/工具，再显示员工×日期网格；员工列和周工时列 sticky 且不遮头尾列。
- [x] 早/午/晚班分别使用可读的浅绿/浅黄/浅珊瑚，班次文字严格对应固定时间。
- [x] 恢复推荐、清空、导入/复制、发布层级清楚；右键菜单有键盘等价入口。

### `/approvals`

- [x] 待审批/审批记录 tabs → 批量工具 → 筛选器 → 紧凑记录列表，激活状态与 `aria-selected` 一致。
- [x] AI 合规建议是次级提示，人工同意/拒绝动作明确；已处理状态带文字。
- [x] 拒绝原因/详情 Dialog 可关闭并恢复焦点；未复刻 Slide 14 的手机画布。

### `/attendance/daily`

- [x] 标题 → 日期/异常/状态/员工查询条 → 计算/批量动作 → 高密度异常表。
- [x] 状态、异常类型、分钟数同一行可扫读，选择列不挤压内容。
- [x] 代理申请为右 Drawer，表单随类型变化，提交/取消保持可见。

### `/attendance/monthly`

- [x] 月份筛选位于表格上方，确认/取消确认在独立工具栏，已选人数明确。
- [x] 计划/实际工时、异常数、0 考勤处理、确认状态同表可见并有文字。
- [x] 未确认日异常 blocker 为可读提示并列出员工/原因；阻断存在时不得确认。

### `/reports/monthly`

- [x] 过滤器顺序为月份、员工、查询；经理页面不显示可编辑门店 ID。
- [x] 5 项汇总指标横排后紧接员工月度明细，计划/实际/请假/修正/异常/状态同屏可扫读。
- [x] 员工旅程最终可定位 `小王` 行的明确“已确认”状态。

### `/reports/scheduling`

- [x] 过滤器顺序为周一、员工、查询；5 项 AI 指标横排后是员工班次与工时表。
- [x] 岗位人力缺口与 V2S 并排，能力搭配位于下方；三表在 1366 宽度不产生页面级溢出。
- [x] 使用固定三班与高/中/低能力统计，未复制旧系统多班次色块。

## 4. 不生成 PNG 的桌面宽度与可访问性行为门禁

- [x] `1279×900` 不生成 PNG，只渲染 `请使用宽屏浏览器访问（最低 1280px）` alert；header、aside、main、AI 助手均不存在。
- [x] `1279×900` 的 `document.documentElement.scrollWidth === 1279`，未因 1280px `min-width` 产生 1px 滚动。
- [x] `1280×900` 正向边界显示 header、aside、main，且不显示 blocker。
- [x] dashboard、排班向导、approvals、daily、monthly 的 axe critical/serious 均为 0。
- [x] 登录手机号/验证码 label 程序化关联，登录按钮 accessible name 为 `登录`。
- [x] 共享及自制 Dialog/Drawer、审批弹层、排班编辑/清空层均通过焦点进入、焦点约束、Escape 和焦点恢复。

## 5. 硬边界否决项

任一项违反即判当前 case `FAIL`，不得以 PPT 原图存在为理由豁免：

- [x] 只做桌面浏览器 Web；不做手机端、APP、移动适配或原生桌面客户端。
- [x] 不做子部门。
- [x] 三个班次固定为 09:00–13:00、13:00–17:00、17:00–21:00。
- [x] 店长不进入排班，不做 DOM 审批。
- [x] 不复刻旧版参考中的第三方品牌、讲义蓝框、红色序号/手指标注或水印。
- [x] 1279×900 不生成 PNG；最终 Web 基线只允许 9 路由×2 视口共 18 张。
- [x] 源 PPT 未复制或提交到 Git；63 张 PPT 参考图只存在于 ignored `test-results/ppt-reference/`。

## 6. 问题与复验记录（实际审查时填写）

| 记录 | 首次审查 case | 可复现问题 | 修复提交 | 复验 case | 复验 reviewer/date | 复验结果 |
|---:|---|---|---|---|---|---|
| 1 | 首轮 18/18 | 报表旧品牌；审批/排班报表 raw enum；工时长小数；排班报表三个分区只有表头且无确定性空态；原生控件英文/美式日期/12 小时制 | `4971b8e` | 修复后 18/18 | T10-VR / 2026-07-19 | PASS：旧品牌、raw enum、长小数清零，空态与中文本地化复验通过 |
| 2 | 最终 approvals 两视口 | pending correction/leave seed 的 `createdAt` 随 `db:reset` 漂移（`16:49:02 → 17:15:44`） | `8d1b0c8` | approvals 两视口双 reset + 最终 18/18 | T10-VR / 2026-07-19 | PASS：双跑 1366 SHA `6d7d0cf…`、1440 SHA `70538277…` 逐字节一致；严格 API→UI gate 通过 |
| 3 | PPT 提取 acceptance | Keynote 异步导入时 `open` 可返回 `missing value`；首版 candidate object 绑定在真实第 2 轮关闭了原 existing ID 并留下新 ID | `90bd062` | stable ID 直接 probe 3/3 + 原始 exact extractor 2/2 | T10-ACC / 2026-07-19 | PASS：before/after existing ID 集合守恒；每轮 63/63、1600×900、关键 SHA 一致、PDF 0 |

最终接受条件已满足：18 行均由独立 reviewer 填写有效 initials、日期和明确结论；存在三条真实问题及修复复验记录；所有问题均已重跑并复验为 PASS；硬计数与 Git 忽略门禁已重新执行并保存证据。自动化接受门禁的完整命令和结果另记录于 Task 10 acceptance report。
