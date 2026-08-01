from __future__ import annotations

import hashlib
import os
from pathlib import Path
import re
import subprocess
import tempfile
import textwrap
import unittest
from unittest import mock


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPOSITORY_ROOT / "scripts" / "extract-ppt-reference.py"
CHECKLIST = REPOSITORY_ROOT / "tests" / "visual" / "ppt-reference-checklist.md"

# SHA-256 of the raw checklist bytes approved at Task 10 base a4df252.
# A legitimate edit must update this value only after a new signed review.
APPROVED_CHECKLIST_SHA256 = (
    "7d556b5cba12358c1561a7bfc73e4c180b3309644a80e6aae02654478dc2dfee"
)

EXPECTED_CHECKED_ITEMS = (
    "从仓库根目录运行 `python3 scripts/extract-ppt-reference.py`。",
    "`test-results/ppt-reference/` 中只有 `slide-001.png` 至 `slide-063.png` 共 63 张参考图；不存在缺页、重复页或旧图。",
    "正式提取使用 Keynote，抽检页中文清晰可辨；LibreOffice 诊断 fallback 的缺少 CJK 字体、缺少所需字形和静默替代拒绝逻辑由提取脚本单测覆盖。",
    "Slides 13/15/52 的标题可区分且 PNG 哈希不碰撞：分别为“店长审批”“门店信息”“异常处理”。",
    "Slides 32/55/59/63 的中文标题与主要说明清晰可辨；Slide 63 显示“到此结束，谢谢！”，未出现 CJK 空心方框。",
    "`git check-ignore test-results/ppt-reference/slide-001.png` 成功，且源 PPT 未复制或提交到 Git。",
    "源文件路径仅通过 `WFM_PPT_REFERENCE` 环境变量传入；源文件未复制或提交到 Git。",
    "数据库、浏览器时间、服务端时间、locale 与 timezone 已按 Task 10 固定；两种视口使用相同业务数据和查询日期。",
    "页面已完成明确就绪门禁，不是在 loading、旧查询、空白闪烁或未关闭弹层状态。",
    "18 张 Web actual 已完成独立视觉审查和两轮真实的“发现问题 → 修复 → 重新核验”，满足接受基线的人工审查门禁。",
    "48px 深色顶栏、208px 左侧菜单、16px 主内容内边距与当前激活态清晰。",
    "页面信息顺序为“标题 → 查询 → 操作 → 数据区”，保持企业后台紧凑密度，不出现营销 Hero 或移动卡片流。",
    "`1366×768` 不隐藏业务列、不缩成不可读字体，`html/body/main` 无横向滚动；只允许表格/排班网格自身滚动。",
    "两视口的数据、月份/周一/日期和请求完成状态一致；无动画、光标、loading 或陈旧数据噪声。",
    "页面只含一个主 `h1`；表格/区域有 accessible name，状态有文字，不能只靠颜色表达。",
    "主按钮、链接和表单控件有明确 label 与可见 `:focus-visible`。",
    "Dialog、Drawer、菜单在主态截图前关闭；行为审查已验证焦点进入、Tab 约束、Escape 关闭和焦点恢复。",
    "AI 助手不遮挡末列、分页、滚动条或主要操作。",
    "对照对应 PPT 页只复核产品结构、密度、颜色和信息层级，未复制讲义装饰或旧品牌。",
    "未出现 APP/移动端、子部门、DOM、旧多班次、店长班表。",
    "深海军蓝一级模块栏、左侧功能树、浅灰内容背景和白色内容表面形成三段层级。",
    "四个指标卡和两个报表入口紧凑可扫读；不伪造 PPT 中不存在的 KPI 图。",
    "1366×768 首屏仍可看到核心指标，AI 按钮不遮挡入口。",
    "顺序为门店查询 → 操作工具栏 → 固定班次摘要 → 七日营业表。",
    "七天营业状态、开闭店时间横向对齐；固定三班明确为只读。",
    "编辑门店 Dialog 为桌面居中两列表单，主动作位于右下且键盘可达。",
    "顶部新增工具栏后紧接高密度工作组表，工作组/组长/业务量/成员/状态/操作同屏可见。",
    "新增/编辑使用居中 Dialog；成员有效期使用右侧 Drawer，底部动作不越出视口。",
    "状态使用克制颜色和明确文字；工作区域未演变为子部门。",
    "月份说明与查询位于 42 格月历上方，月历之后是计划列表，二者不覆盖。",
    "四步固定为排班准备 → 业务预测 → 人力预测 → 自动排班，当前步骤不只靠颜色表示。",
    "自动排班先显示指标/工具，再显示员工×日期网格；员工列和周工时列 sticky 且不遮头尾列。",
    "早/午/晚班分别使用可读的浅绿/浅黄/浅珊瑚，班次文字严格对应固定时间。",
    "恢复推荐、清空、导入/复制、发布层级清楚；右键菜单有键盘等价入口。",
    "待审批/审批记录 tabs → 批量工具 → 筛选器 → 紧凑记录列表，激活状态与 `aria-selected` 一致。",
    "AI 合规建议是次级提示，人工同意/拒绝动作明确；已处理状态带文字。",
    "拒绝原因/详情 Dialog 可关闭并恢复焦点；未复刻 Slide 14 的手机画布。",
    "标题 → 日期/异常/状态/员工查询条 → 计算/批量动作 → 高密度异常表。",
    "状态、异常类型、分钟数同一行可扫读，选择列不挤压内容。",
    "代理申请为右 Drawer，表单随类型变化，提交/取消保持可见。",
    "月份筛选位于表格上方，确认/取消确认在独立工具栏，已选人数明确。",
    "计划/实际工时、异常数、0 考勤处理、确认状态同表可见并有文字。",
    "未确认日异常 blocker 为可读提示并列出员工/原因；阻断存在时不得确认。",
    "过滤器顺序为月份、员工、查询；经理页面不显示可编辑门店 ID。",
    "5 项汇总指标横排后紧接员工月度明细，计划/实际/请假/修正/异常/状态同屏可扫读。",
    "员工旅程最终可定位 `小王` 行的明确“已确认”状态。",
    "过滤器顺序为周一、员工、查询；5 项 AI 指标横排后是员工班次与工时表。",
    "岗位人力缺口与 V2S 并排，能力搭配位于下方；三表在 1366 宽度不产生页面级溢出。",
    "使用固定三班与高/中/低能力统计，未复制旧系统多班次色块。",
    "`1279×900` 不生成 PNG，只渲染 `请使用宽屏浏览器访问（最低 1280px）` alert；header、aside、main、AI 助手均不存在。",
    "`1279×900` 的 `document.documentElement.scrollWidth === 1279`，未因 1280px `min-width` 产生 1px 滚动。",
    "`1280×900` 正向边界显示 header、aside、main，且不显示 blocker。",
    "dashboard、排班向导、approvals、daily、monthly 的 axe critical/serious 均为 0。",
    "登录手机号/验证码 label 程序化关联，登录按钮 accessible name 为 `登录`。",
    "共享及自制 Dialog/Drawer、审批弹层、排班编辑/清空层均通过焦点进入、焦点约束、Escape 和焦点恢复。",
    "只做桌面浏览器 Web；不做手机端、APP、移动适配或原生桌面客户端。",
    "不做子部门。",
    "三个班次固定为 09:00–13:00、13:00–17:00、17:00–21:00。",
    "店长不进入排班，不做 DOM 审批。",
    "不复刻旧版参考中的第三方品牌、讲义蓝框、红色序号/手指标注或水印。",
    "1279×900 不生成 PNG；最终 Web 基线只允许 9 路由×2 视口共 18 张。",
    "源 PPT 未复制或提交到 Git；63 张 PPT 参考图只存在于 ignored `test-results/ppt-reference/`。",
)

EXPECTED_CASE_RECORDS = (
    (
        "01",
        "`/dashboard`",
        "`1440×900`",
        "Slides 32、53、54、60、62",
        "`门店工作台`、pending approvals、报表快捷入口均可见",
        "T10-VR",
        "2026-07-19",
        "PASS",
    ),
    (
        "02",
        "`/dashboard`",
        "`1366×768`",
        "Slides 32、53、54、60、62",
        "与 case 01 相同，核心指标首屏可见",
        "T10-VR",
        "2026-07-19",
        "PASS",
    ),
    (
        "03",
        "`/store/basic`",
        "`1440×900`",
        "Slides 16、18",
        "`门店基础与营业日`、固定班次只读、营业日表头可见",
        "T10-VR",
        "2026-07-19",
        "PASS",
    ),
    (
        "04",
        "`/store/basic`",
        "`1366×768`",
        "Slides 16、18",
        "与 case 03 相同，星期/时间控件无截断",
        "T10-VR",
        "2026-07-19",
        "PASS",
    ),
    (
        "05",
        "`/store/work-groups`",
        "`1440×900`",
        "Slides 20、23、24",
        "`工作组`、新增按钮、六列表头可见",
        "T10-VR",
        "2026-07-19",
        "PASS",
    ),
    (
        "06",
        "`/store/work-groups`",
        "`1366×768`",
        "Slides 20、23、24",
        "与 case 05 相同，操作列不换行漂移",
        "T10-VR",
        "2026-07-19",
        "PASS",
    ),
    (
        "07",
        "`/schedule/plans`",
        "`1440×900`",
        "Slides 32–42、45、48、50–51",
        "月份固定 `2026-07`，月历与种子计划列表稳定",
        "T10-VR",
        "2026-07-19",
        "PASS",
    ),
    (
        "08",
        "`/schedule/plans`",
        "`1366×768`",
        "Slides 32–42、45、48、50–51",
        "与 case 07 相同，日历/列表不覆盖",
        "T10-VR",
        "2026-07-19",
        "PASS",
    ),
    (
        "09",
        "`/approvals`",
        "`1440×900`",
        "Slide 14（仅流程）；Slides 53、54、60（桌面结构）",
        "`统一审批中心`、tablist、两条固定待审批 seed 与时间稳定",
        "T10-VR",
        "2026-07-19",
        "PASS",
    ),
    (
        "10",
        "`/approvals`",
        "`1366×768`",
        "Slide 14（仅流程）；Slides 53、54、60（桌面结构）",
        "与 case 09 相同，不出现移动端画布",
        "T10-VR",
        "2026-07-19",
        "PASS",
    ),
    (
        "11",
        "`/attendance/daily`",
        "`1440×900`",
        "Slides 54–58",
        "固定日期，`日考勤异常` 表格或确定性空态稳定",
        "T10-VR",
        "2026-07-19",
        "PASS",
    ),
    (
        "12",
        "`/attendance/daily`",
        "`1366×768`",
        "Slides 54–58",
        "与 case 11 相同，工具栏动作不掉出视口",
        "T10-VR",
        "2026-07-19",
        "PASS",
    ),
    (
        "13",
        "`/attendance/monthly`",
        "`1440×900`",
        "Slides 59–62",
        "月份 `2026-07`，表格或 blocker 稳定",
        "T10-VR",
        "2026-07-19",
        "PASS",
    ),
    (
        "14",
        "`/attendance/monthly`",
        "`1366×768`",
        "Slides 59–62",
        "与 case 13 相同，确认工具栏和状态可见",
        "T10-VR",
        "2026-07-19",
        "PASS",
    ),
    (
        "15",
        "`/reports/monthly`",
        "`1440×900`",
        "Slides 59、61、62",
        "查询 `2026-07` 后，月度汇总与 named table 稳定",
        "T10-VR",
        "2026-07-19",
        "PASS",
    ),
    (
        "16",
        "`/reports/monthly`",
        "`1366×768`",
        "Slides 59、61、62",
        "与 case 15 相同，指标不挤掉明细首屏",
        "T10-VR",
        "2026-07-19",
        "PASS",
    ),
    (
        "17",
        "`/reports/scheduling`",
        "`1440×900`",
        "Slides 38–40、44–46",
        "查询周一 `2026-07-20` 后，AI 指标与员工表稳定",
        "T10-VR",
        "2026-07-19",
        "PASS",
    ),
    (
        "18",
        "`/reports/scheduling`",
        "`1366×768`",
        "Slides 38–40、44–46",
        "与 case 17 相同，V2S/缺口/能力表无页面级溢出",
        "T10-VR",
        "2026-07-19",
        "PASS",
    ),
)

EXPECTED_PROBLEM_RECORDS = (
    (
        "1",
        "首轮 18/18",
        "报表旧品牌；审批/排班报表 raw enum；工时长小数；排班报表三个分区只有表头且无确定性空态；原生控件英文/美式日期/12 小时制",
        "`4971b8e`",
        "修复后 18/18",
        "T10-VR / 2026-07-19",
        "PASS：旧品牌、raw enum、长小数清零，空态与中文本地化复验通过",
    ),
    (
        "2",
        "最终 approvals 两视口",
        "pending correction/leave seed 的 `createdAt` 随 `db:reset` 漂移（`16:49:02 → 17:15:44`）",
        "`8d1b0c8`",
        "approvals 两视口双 reset + 最终 18/18",
        "T10-VR / 2026-07-19",
        "PASS：双跑 1366 SHA `6d7d0cf…`、1440 SHA `70538277…` 逐字节一致；严格 API→UI gate 通过",
    ),
    (
        "3",
        "PPT 提取 acceptance",
        "Keynote 异步导入时 `open` 可返回 `missing value`；首版 candidate object 绑定在真实第 2 轮关闭了原 existing ID 并留下新 ID",
        "`90bd062`",
        "stable ID 直接 probe 3/3 + 原始 exact extractor 2/2",
        "T10-ACC / 2026-07-19",
        "PASS：before/after existing ID 集合守恒；每轮 63/63、1600×900、关键 SHA 一致、PDF 0",
    ),
)

CASE_SECTION_HEADING = "## 1. 18 个路由/视口审查记录"
CASE_SECTION_END_HEADING = "## 2. 每个 case 都必须执行的全局检查"
CASE_TABLE_HEADER = (
    "| # | Route | Viewport | PPT 证据 | 截图前就绪门禁 | Reviewer | 日期 | 结果 |"
)
CASE_TABLE_SEPARATOR = "|---:|---|---|---|---|---|---|---|"

PROBLEM_SECTION_HEADING = "## 6. 问题与复验记录（实际审查时填写）"
PROBLEM_TABLE_HEADER = (
    "| 记录 | 首次审查 case | 可复现问题 | 修复提交 | 复验 case | "
    "复验 reviewer/date | 复验结果 |"
)
PROBLEM_TABLE_SEPARATOR = "|---:|---|---|---|---|---|---|"


class ExtractPptReferenceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.workspace = Path(self.temporary_directory.name)
        self.source = self.workspace / "WFM reference deck.pptx"
        self.source.write_bytes(b"fake pptx")
        self.system_cjk_font = self.workspace / "System CJK.ttf"
        self.system_cjk_font.write_bytes(b"fake system font")
        self.fake_keynote_app = self.workspace / "Keynote.app"
        self.fake_keynote_app.mkdir()
        self.keynote_marker = self.workspace / "keynote-exported.txt"
        self.binary_directory = self.workspace / "bin"
        self.binary_directory.mkdir()
        self._write_executable(
            "soffice",
            """
            from pathlib import Path
            import sys

            output = Path(sys.argv[sys.argv.index("--outdir") + 1])
            source = Path(sys.argv[-1])
            (output / f"{source.stem}.pdf").write_bytes(b"fake pdf")
            """,
        )
        self._write_executable(
            "pdftoppm",
            """
            import os
            from pathlib import Path
            import sys

            prefix = Path(sys.argv[-1])
            for page in range(1, int(os.environ["FAKE_SLIDE_COUNT"]) + 1):
                content = f"page {page}".encode()
                if os.environ.get("FAKE_COLLIDE_SECTIONS") == "1" and page in (13, 15, 52):
                    content = b"same broken title slide"
                prefix.with_name(f"{prefix.name}-{page}.png").write_bytes(
                    content
                )
            """,
        )
        self._write_executable(
            "fc-match",
            """
            import os

            if os.environ.get("FAKE_CJK_AVAILABLE") == "1":
                print(os.environ["FAKE_CJK_FONT"])
                print("System CJK")
                print("zh-cn|en")
            else:
                print("/System/Library/Fonts/Verdana.ttf")
                print("Verdana")
                print("en")
            """,
        )
        self._write_executable(
            "fc-query",
            """
            import os

            if os.environ.get("FAKE_CJK_COVERS_REQUIRED") == "1":
                print("20-7e 3000-303f 4e00-9fff ff00-ffef")
            else:
                print("20-7e")
            """,
        )
        self._write_executable(
            "osascript",
            """
            import os
            from pathlib import Path
            import sys

            script = Path(sys.argv[1]).read_text(encoding="utf-8")
            if (
                os.environ.get("FAKE_KEYNOTE_CREATES_DOCUMENT") == "0"
                and "Keynote did not create a new document after open" in script
            ):
                Path(sys.argv[-1]).write_bytes(b"partial keynote pdf")
                print(
                    "Keynote did not create a new document after open",
                    file=sys.stderr,
                )
                raise SystemExit(1)
            Path(sys.argv[-1]).write_bytes(b"fake keynote pdf")
            Path(os.environ["FAKE_KEYNOTE_MARKER"]).write_text(
                "keynote", encoding="utf-8"
            )
            """,
        )

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def _write_executable(self, name: str, body: str) -> None:
        executable = self.binary_directory / name
        executable.write_text(
            "#!/usr/bin/env python3\n" + textwrap.dedent(body), encoding="utf-8"
        )
        executable.chmod(0o755)

    def _run_script(
        self,
        slide_count: int,
        *,
        cjk_available: bool = True,
        cjk_covers_required: bool = True,
        collide_sections: bool = False,
        keynote_available: bool = True,
        keynote_creates_document: bool = True,
        renderer: str = "keynote",
    ) -> subprocess.CompletedProcess[str]:
        environment = os.environ.copy()
        environment.update(
            {
                "FAKE_SLIDE_COUNT": str(slide_count),
                "FAKE_CJK_AVAILABLE": "1" if cjk_available else "0",
                "FAKE_CJK_COVERS_REQUIRED": "1" if cjk_covers_required else "0",
                "FAKE_CJK_FONT": str(self.system_cjk_font),
                "FAKE_COLLIDE_SECTIONS": "1" if collide_sections else "0",
                "FAKE_KEYNOTE_MARKER": str(self.keynote_marker),
                "FAKE_KEYNOTE_CREATES_DOCUMENT": (
                    "1" if keynote_creates_document else "0"
                ),
                "WFM_KEYNOTE_APP": str(
                    self.fake_keynote_app
                    if keynote_available
                    else self.workspace / "Missing Keynote.app"
                ),
                "WFM_PPT_RENDERER": renderer,
                "PATH": f"{self.binary_directory}{os.pathsep}{environment['PATH']}",
                "WFM_PPT_REFERENCE": str(self.source),
            }
        )
        return subprocess.run(
            ["python3", str(SCRIPT)],
            cwd=self.workspace,
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )

    def test_requires_explicit_authorized_reference_path(self) -> None:
        environment = os.environ.copy()
        environment.pop("WFM_PPT_REFERENCE", None)
        result = subprocess.run(
            ["python3", str(SCRIPT)],
            cwd=self.workspace,
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn(
            "WFM_PPT_REFERENCE must point to the authorized visual reference deck",
            result.stderr,
        )

    def test_replaces_stale_slides_with_exact_three_digit_sequence(self) -> None:
        output = self.workspace / "test-results" / "ppt-reference"
        output.mkdir(parents=True)
        (output / "slide-999.png").write_bytes(b"stale")
        (output / "keep.txt").write_text("sentinel", encoding="utf-8")

        result = self._run_script(slide_count=63)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            sorted(path.name for path in output.glob("slide-*.png")),
            [f"slide-{page:03d}.png" for page in range(1, 64)],
        )
        self.assertEqual((output / "slide-001.png").read_bytes(), b"page 1")
        self.assertEqual((output / "slide-063.png").read_bytes(), b"page 63")
        self.assertEqual((output / "keep.txt").read_text(encoding="utf-8"), "sentinel")
        self.assertFalse((output / f"{self.source.stem}.pdf").exists())

    def test_rejects_non_63_page_render_and_removes_partial_slides(self) -> None:
        result = self._run_script(slide_count=62)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("expected exactly 63 slides, got 62", result.stderr)
        output = self.workspace / "test-results" / "ppt-reference"
        self.assertEqual(list(output.glob("slide-*.png")), [])
        self.assertFalse((output / f"{self.source.stem}.pdf").exists())

    def test_rejects_missing_cjk_fallback_before_rendering(self) -> None:
        result = self._run_script(
            slide_count=63, cjk_available=False, renderer="libreoffice"
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("No usable system CJK font", result.stderr)
        output = self.workspace / "test-results" / "ppt-reference"
        self.assertEqual(list(output.glob("slide-*.png")), [])
        self.assertFalse((output / f"{self.source.stem}.pdf").exists())

    def test_rejects_cjk_fallback_without_required_glyphs(self) -> None:
        result = self._run_script(
            slide_count=63, cjk_covers_required=False, renderer="libreoffice"
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("does not cover required PPT characters", result.stderr)
        output = self.workspace / "test-results" / "ppt-reference"
        self.assertEqual(list(output.glob("slide-*.png")), [])
        self.assertFalse((output / f"{self.source.stem}.pdf").exists())

    def test_rejects_colliding_section_renders_and_cleans_all_slides(self) -> None:
        result = self._run_script(slide_count=63, collide_sections=True)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("render collision for distinct slides 13, 15 and 52", result.stderr)
        output = self.workspace / "test-results" / "ppt-reference"
        self.assertEqual(list(output.glob("slide-*.png")), [])
        self.assertFalse((output / f"{self.source.stem}.pdf").exists())

    def test_uses_keynote_export_for_layout_fidelity(self) -> None:
        result = self._run_script(slide_count=63)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(self.keynote_marker.is_file(), "Keynote exporter was not called")
        self.assertEqual(self.keynote_marker.read_text(encoding="utf-8"), "keynote")

    def test_keynote_export_tracks_and_closes_only_a_new_document(self) -> None:
        source = SCRIPT.read_text(encoding="utf-8")

        self.assertIn("set existingDocumentIds to id of every document", source)
        self.assertIn("open POSIX file sourcePath", source)
        self.assertNotIn("set sourceDocument to open POSIX file sourcePath", source)
        self.assertIn("repeat with pollIndex from 1 to 120", source)
        self.assertIn(
            "set candidateDocumentId to (id of candidateDocument) as text",
            source,
        )
        self.assertIn(
            "existingDocumentIds does not contain candidateDocumentId",
            source,
        )
        self.assertIn("set sourceDocumentId to missing value", source)
        self.assertIn(
            "set sourceDocumentId to (candidateDocumentId as text)",
            source,
        )
        self.assertNotIn("set sourceDocument to candidateDocument", source)
        self.assertIn(
            'error "Keynote did not create a new document after open" number 7301',
            source,
        )
        self.assertIn(
            "export (document id sourceDocumentId) to POSIX file destinationPath as PDF",
            source,
        )
        self.assertEqual(
            source.count("close (document id sourceDocumentId) saving no"),
            2,
        )
        self.assertNotIn("close sourceDocument saving no", source)
        self.assertNotIn("front document", source)
        self.assertNotIn("close every document", source)
        self.assertRegex(source, r"KEYNOTE_EXPORT_TIMEOUT_SECONDS\s*=\s*180")
        self.assertIn("timeout=KEYNOTE_EXPORT_TIMEOUT_SECONDS", source)
        self.assertIn("except subprocess.TimeoutExpired", source)

    def test_keynote_missing_new_document_fails_and_cleans_partial_output(self) -> None:
        result = self._run_script(
            slide_count=63,
            keynote_creates_document=False,
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Keynote did not create a new document after open", result.stderr)
        output = self.workspace / "test-results" / "ppt-reference"
        self.assertEqual(list(output.glob("slide-*.png")), [])
        self.assertFalse((output / f"{self.source.stem}.pdf").exists())

    def test_rejects_missing_keynote_without_silent_libreoffice_fallback(self) -> None:
        result = self._run_script(slide_count=63, keynote_available=False)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Keynote is required", result.stderr)
        output = self.workspace / "test-results" / "ppt-reference"
        self.assertEqual(list(output.glob("slide-*.png")), [])
        self.assertFalse((output / f"{self.source.stem}.pdf").exists())

    def _assert_mutated_checklist_is_rejected(self, content: str) -> None:
        mutated_checklist = self.workspace / "mutated-ppt-reference-checklist.md"
        mutated_checklist.write_text(content, encoding="utf-8")
        with mock.patch(f"{__name__}.CHECKLIST", mutated_checklist):
            with self.assertRaises(AssertionError):
                self.test_checklist_contains_18_signed_pass_cases_problem_records_and_hard_boundaries()

    def _assert_checked_items_contract(self, content: str) -> None:
        task_list_lines = [
            line
            for line in content.splitlines()
            if re.match(r"^\s*[-+*]\s+\[", line)
        ]
        checked_items: list[str] = []
        for line in task_list_lines:
            task_match = re.fullmatch(
                r"- \[(?P<state>[^\]]*)\] (?P<text>.+)",
                line,
            )
            self.assertIsNotNone(task_match, f"invalid task-list item: {line}")
            assert task_match is not None
            self.assertEqual(task_match.group("state"), "x")
            checked_items.append(task_match.group("text"))

        self.assertEqual(len(EXPECTED_CHECKED_ITEMS), 62)
        self.assertEqual(tuple(checked_items), EXPECTED_CHECKED_ITEMS)

    def _section_lines(
        self,
        content: str,
        *,
        start_heading: str,
        end_heading: str | None = None,
    ) -> list[str]:
        lines = content.splitlines()
        self.assertEqual(lines.count(start_heading), 1)
        start_index = lines.index(start_heading)
        if end_heading is None:
            return lines[start_index + 1 :]

        self.assertEqual(lines.count(end_heading), 1)
        end_index = lines.index(end_heading)
        self.assertGreater(end_index, start_index)
        return lines[start_index + 1 : end_index]

    def _parse_strict_markdown_table(
        self,
        section_lines: list[str],
        *,
        header: str,
        separator: str,
        expected_rows: tuple[tuple[str, ...], ...],
        column_count: int,
        table_name: str,
    ) -> tuple[tuple[str, ...], ...]:
        self.assertEqual(section_lines.count(header), 1)
        header_index = section_lines.index(header)
        separator_index = header_index + 1
        self.assertLess(separator_index, len(section_lines))
        self.assertEqual(section_lines[separator_index], separator)

        first_row_index = separator_index + 1
        after_rows_index = first_row_index + len(expected_rows)
        self.assertLessEqual(after_rows_index, len(section_lines))
        actual_rows: list[tuple[str, ...]] = []
        for line in section_lines[first_row_index:after_rows_index]:
            self.assertTrue(
                line.startswith("|") and line.endswith("|"),
                f"{table_name} row is not contiguous pipe syntax: {line!r}",
            )
            cells = tuple(cell.strip() for cell in line[1:-1].split("|"))
            self.assertEqual(
                len(cells),
                column_count,
                f"invalid {table_name} columns: {line}",
            )
            self.assertTrue(all(cells), f"empty {table_name} field: {line}")
            actual_rows.append(cells)

        table_indexes = set(range(header_index, after_rows_index))
        for index, line in enumerate(section_lines):
            stripped_line = line.strip()
            if index in table_indexes or not stripped_line:
                continue
            self.assertFalse(
                stripped_line.startswith("|") or stripped_line.endswith("|"),
                f"unexpected pipe row outside {table_name}: {line}",
            )

        actual_rows_tuple = tuple(actual_rows)
        identifiers = tuple(row[0] for row in actual_rows_tuple)
        self.assertEqual(len(identifiers), len(set(identifiers)))
        self.assertEqual(actual_rows_tuple, expected_rows)
        return actual_rows_tuple

    def _assert_case_records_contract(self, content: str) -> None:
        self.assertEqual(len(EXPECTED_CASE_RECORDS), 18)
        self.assertTrue(all(len(row) == 8 for row in EXPECTED_CASE_RECORDS))
        case_section = self._section_lines(
            content,
            start_heading=CASE_SECTION_HEADING,
            end_heading=CASE_SECTION_END_HEADING,
        )
        self._parse_strict_markdown_table(
            case_section,
            header=CASE_TABLE_HEADER,
            separator=CASE_TABLE_SEPARATOR,
            expected_rows=EXPECTED_CASE_RECORDS,
            column_count=8,
            table_name="case review table",
        )

    def _assert_problem_records_contract(self, content: str) -> None:
        self.assertEqual(len(EXPECTED_PROBLEM_RECORDS), 3)
        self.assertTrue(all(len(row) == 7 for row in EXPECTED_PROBLEM_RECORDS))
        problem_section = self._section_lines(
            content,
            start_heading=PROBLEM_SECTION_HEADING,
        )
        self._parse_strict_markdown_table(
            problem_section,
            header=PROBLEM_TABLE_HEADER,
            separator=PROBLEM_TABLE_SEPARATOR,
            expected_rows=EXPECTED_PROBLEM_RECORDS,
            column_count=7,
            table_name="problem review table",
        )

    def test_checklist_contract_rejects_checked_items_deleted_to_nine(self) -> None:
        checked_items_to_keep = (
            "从仓库根目录运行",
            "Slides 13/15/52 的标题",
            "Slides 32/55/59/63 的中文标题",
            "只做桌面浏览器 Web",
            "不做子部门",
            "09:00–13:00、13:00–17:00、17:00–21:00",
            "店长不进入排班，不做 DOM 审批",
            "1279×900 不生成 PNG；最终 Web 基线",
            "源 PPT 未复制或提交到 Git；63 张 PPT 参考图",
        )
        checked_items_seen = 0
        checked_items_kept = 0
        mutated_lines: list[str] = []
        for line in CHECKLIST.read_text(encoding="utf-8").splitlines():
            if line.startswith("- [x] "):
                checked_items_seen += 1
                if not any(fragment in line for fragment in checked_items_to_keep):
                    continue
                checked_items_kept += 1
            mutated_lines.append(line)

        self.assertEqual(checked_items_seen, 62)
        self.assertEqual(checked_items_kept, 9)
        self._assert_mutated_checklist_is_rejected("\n".join(mutated_lines) + "\n")

    def test_checklist_contract_rejects_fail_in_problem_final_result_column(self) -> None:
        content = CHECKLIST.read_text(encoding="utf-8")
        mutated = content.replace(
            "| 1 | 首轮 18/18 | ",
            "| 1 | 首轮 18/18 PASS evidence | ",
            1,
        ).replace(
            "| PASS：旧品牌、raw enum、长小数清零",
            "| FAIL：旧品牌、raw enum、长小数清零",
            1,
        )

        self.assertNotEqual(mutated, content)
        self._assert_mutated_checklist_is_rejected(mutated)

    def test_checklist_contract_rejects_blank_problem_evidence_columns(self) -> None:
        content = CHECKLIST.read_text(encoding="utf-8")
        mutated_lines: list[str] = []
        mutated_record = False
        for line in content.splitlines():
            if line.startswith("| 1 |"):
                cells = [cell.strip() for cell in line[1:-1].split("|")]
                self.assertEqual(len(cells), 7)
                for column in (1, 2, 4):
                    cells[column] = ""
                line = "| " + " | ".join(cells) + " |"
                mutated_record = True
            mutated_lines.append(line)

        self.assertTrue(mutated_record)
        self._assert_mutated_checklist_is_rejected("\n".join(mutated_lines) + "\n")

    def test_checklist_contract_rejects_extra_non_numeric_problem_record(self) -> None:
        content = CHECKLIST.read_text(encoding="utf-8")
        fake_record = (
            "| bogus | 伪记录 | 无问题 | `deadbee` | 无复验 | "
            "NOBODY / 1900-01-01 | FAIL：不应被忽略 |"
        )
        record_three = next(
            line
            for line in content.splitlines()
            if line.startswith("| 3 |")
        )
        mutated = content.replace(
            record_three,
            f"{record_three}\n{fake_record}",
            1,
        )

        self.assertNotEqual(mutated, content)
        self._assert_mutated_checklist_is_rejected(mutated)

    def test_problem_table_contract_rejects_structural_mutations(self) -> None:
        content = CHECKLIST.read_text(encoding="utf-8")
        lines = content.splitlines()
        row_1 = next(line for line in lines if line.startswith("| 1 |"))
        row_2 = next(line for line in lines if line.startswith("| 2 |"))
        row_3 = next(line for line in lines if line.startswith("| 3 |"))
        row_1_index = lines.index(row_1)
        row_2_index = lines.index(row_2)
        reordered_lines = list(lines)
        reordered_lines[row_1_index], reordered_lines[row_2_index] = (
            reordered_lines[row_2_index],
            reordered_lines[row_1_index],
        )
        fake_numeric_record = (
            "| 4 | 额外审查 | 伪问题 | `deadbee` | 伪复验 | "
            "NOBODY / 1900-01-01 | PASS：不应被忽略 |"
        )
        second_header = (
            "| 伪记录 | 伪首审 | 伪问题 | 伪提交 | 伪复验 | "
            "伪 reviewer/date | 伪结果 |"
        )
        conclusion = "最终接受条件已满足"
        mutations = (
            ("reordered_records", "\n".join(reordered_lines) + "\n"),
            (
                "blank_after_separator",
                content.replace(
                    f"{PROBLEM_TABLE_SEPARATOR}\n{row_1}",
                    f"{PROBLEM_TABLE_SEPARATOR}\n\n{row_1}",
                    1,
                ),
            ),
            (
                "non_pipe_after_separator",
                content.replace(
                    f"{PROBLEM_TABLE_SEPARATOR}\n{row_1}",
                    f"{PROBLEM_TABLE_SEPARATOR}\nMALFORMED ROW\n{row_1}",
                    1,
                ),
            ),
            (
                "hidden_record_after_boundary_break",
                content.replace(
                    f"{row_3}\n\n{conclusion}",
                    f"{row_3}\n\n{fake_numeric_record}\n\n{conclusion}",
                    1,
                ),
            ),
            (
                "hidden_second_table_after_boundary_break",
                content.replace(
                    f"{row_3}\n\n{conclusion}",
                    f"{row_3}\n\n{second_header}\n{PROBLEM_TABLE_SEPARATOR}\n"
                    f"{fake_numeric_record}\n\n{conclusion}",
                    1,
                ),
            ),
            (
                "extra_trailing_pipe_column",
                content.replace(row_1, f"{row_1}|", 1),
            ),
            (
                "numeric_record_before_header",
                content.replace(
                    PROBLEM_TABLE_HEADER,
                    f"{fake_numeric_record}\n{PROBLEM_TABLE_HEADER}",
                    1,
                ),
            ),
            (
                "separator_after_table_boundary",
                content.replace(
                    f"{row_3}\n\n{conclusion}",
                    f"{row_3}\n\n{PROBLEM_TABLE_SEPARATOR}\n\n{conclusion}",
                    1,
                ),
            ),
        )

        for name, mutated in mutations:
            with self.subTest(name=name):
                self.assertNotEqual(mutated, content)
                self._assert_mutated_checklist_is_rejected(mutated)

    def test_case_table_contract_rejects_structural_mutations(self) -> None:
        content = CHECKLIST.read_text(encoding="utf-8")
        lines = content.splitlines()
        header = (
            "| # | Route | Viewport | PPT 证据 | 截图前就绪门禁 | Reviewer | 日期 | 结果 |"
        )
        separator = "|---:|---|---|---|---|---|---|---|"
        row_01 = next(line for line in lines if line.startswith("| 01 |"))
        row_02 = next(line for line in lines if line.startswith("| 02 |"))
        row_18 = next(line for line in lines if line.startswith("| 18 |"))
        row_01_index = lines.index(row_01)
        row_02_index = lines.index(row_02)
        reordered_lines = list(lines)
        reordered_lines[row_01_index], reordered_lines[row_02_index] = (
            reordered_lines[row_02_index],
            reordered_lines[row_01_index],
        )
        row_01_cells = [cell.strip() for cell in row_01[1:-1].split("|")]
        self.assertEqual(len(row_01_cells), 8)
        blank_evidence_cells = list(row_01_cells)
        blank_evidence_cells[3] = ""
        blank_evidence_cells[4] = " "
        blank_evidence_row = "| " + " | ".join(blank_evidence_cells) + " |"
        extra_column_cells = list(row_01_cells)
        extra_column_cells.insert(4, "额外证据")
        extra_column_row = "| " + " | ".join(extra_column_cells) + " |"
        bogus_row = (
            "| bogus | `/fake` | `1440×900` | 伪 PPT | 伪门禁 | "
            "NOBODY | 1900-01-01 | FAIL |"
        )
        section_two = "## 2. 每个 case 都必须执行的全局检查"
        mutations = (
            (
                "blank_evidence_columns",
                content.replace(row_01, blank_evidence_row, 1),
            ),
            (
                "duplicate_case_number",
                content.replace(row_02, row_02.replace("| 02 |", "| 01 |", 1), 1),
            ),
            ("reordered_case_rows", "\n".join(reordered_lines) + "\n"),
            (
                "deleted_header_and_separator",
                content.replace(f"{header}\n{separator}\n", "", 1),
            ),
            (
                "repeated_header_and_separator",
                content.replace(
                    f"{header}\n{separator}",
                    f"{header}\n{separator}\n{header}\n{separator}",
                    1,
                ),
            ),
            (
                "extra_bogus_case_row",
                content.replace(
                    f"{row_18}\n\n{section_two}",
                    f"{row_18}\n{bogus_row}\n\n{section_two}",
                    1,
                ),
            ),
            (
                "extra_case_column",
                content.replace(row_01, extra_column_row, 1),
            ),
        )

        for name, mutated in mutations:
            with self.subTest(name=name):
                self.assertNotEqual(mutated, content)
                self._assert_mutated_checklist_is_rejected(mutated)

    def test_checklist_contract_rejects_noncanonical_task_list_tokens(self) -> None:
        content = CHECKLIST.read_text(encoding="utf-8")
        mutations = (
            ("uppercase_checked", f"{content}\n- [X] 额外签署项。\n"),
            ("unchecked", f"{content}\n- [ ] 额外签署项。\n"),
            ("illegal_state", f"{content}\n- [?] 额外签署项。\n"),
        )

        for name, mutated in mutations:
            with self.subTest(name=name):
                self._assert_mutated_checklist_is_rejected(mutated)

    def test_frozen_checklist_rejects_outer_pipe_free_table_mutations(self) -> None:
        content = CHECKLIST.read_text(encoding="utf-8")
        lines = content.splitlines()
        problem_row_3 = next(line for line in lines if line.startswith("| 3 |"))
        case_row_18 = next(line for line in lines if line.startswith("| 18 |"))
        conclusion = "最终接受条件已满足"
        section_two = CASE_SECTION_END_HEADING
        problem_extra_row = (
            "4 | 额外审查 | 伪问题 | `deadbee` | 伪复验 | "
            "NOBODY / 1900-01-01 | FAIL：不应被忽略"
        )
        case_extra_row = (
            "19 | `/fake` | `1440×900` | 伪 PPT | 伪门禁 | "
            "NOBODY | 1900-01-01 | FAIL"
        )
        problem_second_table = "\n".join(
            (
                "record | first | issue | commit | rerun | reviewer | result",
                "---: | --- | --- | --- | --- | --- | ---",
                "4 | fake | fake | `deadbee` | fake | "
                "T10-VR / 2026-07-19 | PASS：fake",
            )
        )
        case_second_table = "\n".join(
            (
                "# | Route | Viewport | PPT evidence | readiness | Reviewer | date | result",
                "---: | --- | --- | --- | --- | --- | --- | ---",
                "19 | `/fake` | `1×1` | fake | fake | NOBODY | 1900-01-01 | FAIL",
            )
        )
        mutations = (
            (
                "problem_extra_row_without_outer_pipes",
                content.replace(
                    problem_row_3,
                    f"{problem_row_3}\n{problem_extra_row}",
                    1,
                ),
            ),
            (
                "problem_second_table_without_outer_pipes",
                content.replace(
                    f"{problem_row_3}\n\n{conclusion}",
                    f"{problem_row_3}\n\n{problem_second_table}\n\n{conclusion}",
                    1,
                ),
            ),
            (
                "problem_separator_without_outer_pipes",
                content.replace(
                    f"{problem_row_3}\n\n{conclusion}",
                    f"{problem_row_3}\n\n--- | --- | ---\n\n{conclusion}",
                    1,
                ),
            ),
            (
                "case_extra_row_without_outer_pipes",
                content.replace(
                    case_row_18,
                    f"{case_row_18}\n{case_extra_row}",
                    1,
                ),
            ),
            (
                "case_second_table_without_outer_pipes",
                content.replace(
                    f"{case_row_18}\n\n{section_two}",
                    f"{case_row_18}\n\n{case_second_table}\n\n{section_two}",
                    1,
                ),
            ),
            (
                "case_separator_without_outer_pipes",
                content.replace(
                    f"{case_row_18}\n\n{section_two}",
                    f"{case_row_18}\n\n--- | --- | ---\n\n{section_two}",
                    1,
                ),
            ),
        )

        for name, mutated in mutations:
            with self.subTest(name=name):
                self.assertNotEqual(mutated, content)
                self._assert_mutated_checklist_is_rejected(mutated)

    def test_frozen_checklist_rejects_ordered_and_quoted_task_items(self) -> None:
        content = CHECKLIST.read_text(encoding="utf-8")
        task_items = (
            "1. [X] extra signed item",
            "1. [ ] extra unsigned item",
            "1) [X] extra signed item",
            "1) [ ] extra unsigned item",
            "> - [X] extra quoted signed item",
            "> - [ ] extra quoted unsigned item",
            "> > - [X] extra nested quoted signed item",
            "> > - [ ] extra nested quoted unsigned item",
            "> 1. [X] extra quoted ordered signed item",
            "> 1. [ ] extra quoted ordered unsigned item",
            "  > 1) [X] extra nested ordered signed item",
            "  > 1) [ ] extra nested ordered unsigned item",
        )

        for task_item in task_items:
            with self.subTest(task_item=task_item):
                self._assert_mutated_checklist_is_rejected(
                    f"{content}\n{task_item}\n"
                )

    def test_approved_checklist_bytes_match_frozen_sha256(self) -> None:
        self.assertEqual(
            hashlib.sha256(CHECKLIST.read_bytes()).hexdigest(),
            APPROVED_CHECKLIST_SHA256,
        )

    def test_checklist_contains_18_signed_pass_cases_problem_records_and_hard_boundaries(self) -> None:
        self.assertTrue(CHECKLIST.is_file(), "PPT review checklist is missing")
        checklist_bytes = CHECKLIST.read_bytes()
        self.assertEqual(
            hashlib.sha256(checklist_bytes).hexdigest(),
            APPROVED_CHECKLIST_SHA256,
        )
        content = checklist_bytes.decode("utf-8")
        self._assert_checked_items_contract(content)
        self._assert_case_records_contract(content)
        self._assert_problem_records_contract(content)


if __name__ == "__main__":
    unittest.main()
