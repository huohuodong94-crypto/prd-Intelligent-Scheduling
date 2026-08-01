"""
优化引擎最小可跑通测试用例。
按需求文档要求：一个可以直接跑通的最小示例（这里用 4 个员工、3 天排班）。

运行：
    cd schedule-engine
    python test_solver.py        # 直接看结果
    # 或用 pytest： pytest test_solver.py
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from main import SolveRequest
from solver import solve_schedule

DAYS = ["2026-07-13", "2026-07-14", "2026-07-15"]  # 周一~周三
SHIFTS = ["morning", "afternoon", "evening"]


def build_payload() -> dict:
    return {
        "week_of": "2026-07-13",
        "days": DAYS,
        "shifts": SHIFTS,
        # 每天早/午/晚各需要的人数
        "demand": {
            "2026-07-13": {"morning": 2, "afternoon": 1, "evening": 1},
            "2026-07-14": {"morning": 1, "afternoon": 2, "evening": 1},
            "2026-07-15": {"morning": 1, "afternoon": 1, "evening": 2},
        },
        "employees": [
            {"id": "e1", "name": "小王", "position": "sales", "max_weekly_hours": 40, "last_week_hours": 20},
            {"id": "e2", "name": "小李", "position": "cashier", "max_weekly_hours": 40, "last_week_hours": 32,
             # e2 周二全天请假：三个班次都不可用
             "unavailable": [
                 {"date": "2026-07-14", "shift": "morning"},
                 {"date": "2026-07-14", "shift": "afternoon"},
                 {"date": "2026-07-14", "shift": "evening"},
             ]},
            {"id": "e3", "name": "小张", "position": "sales", "max_weekly_hours": 40, "last_week_hours": 8},
            {"id": "e4", "name": "小赵", "position": "cashier", "max_weekly_hours": 40, "last_week_hours": 0},
        ],
        "shift_hours": 4,
        "min_rest_hours": 8,
        "max_weekly_hours": 40,
        # LLM 解析出的软偏好：多给 e1 排早班
        "preferences": [
            {"employee_id": "e1", "shift": "morning", "weight": "soft"},
        ],
    }


def test_solver_feasible():
    result = solve_schedule(build_payload())
    assert result["status"] in ("feasible", "feasible_with_gaps"), result

    # 硬约束校验：e2 周二不应被排任何班
    for a in result["assignments"]:
        if a["employee_id"] == "e2":
            assert a["date"] != "2026-07-14", f"请假期间被排班: {a}"

    # 硬约束校验：任意员工每天最多 1 个班次（8h 休息间隔 → 同日不可两班）
    seen: dict[tuple[str, str], int] = {}
    for a in result["assignments"]:
        key = (a["employee_id"], a["date"])
        seen[key] = seen.get(key, 0) + 1
    for key, cnt in seen.items():
        assert cnt <= 1, f"同日多班违反休息间隔: {key} -> {cnt}"

    print("== 求解状态:", result["status"], "| 用时(ms):", result.get("solve_time_ms"))
    print("== 排班结果:")
    for a in sorted(result["assignments"], key=lambda r: (r["date"], r["shift"])):
        print(f"   {a['date']} {a['shift']:<9} -> {a['employee_id']}")
    if result["gaps"]:
        print("== 人数缺口:")
        for g in result["gaps"]:
            print(f"   {g['date']} {g['shift']} 需{g['required']} 缺{g['shortfall']}")
    else:
        print("== 无人数缺口，全部时段满足")


def test_work5rest2_limits_distinct_work_days():
    payload = build_payload()
    payload["days"] = [f"2026-07-{day:02d}" for day in range(20, 27)]
    payload["employees"] = [
        {
            "id": "e1",
            "name": "小王",
            "position": "sales",
            "max_weekly_hours": 40,
            "last_week_hours": 0,
        }
    ]
    payload["preferences"] = []
    payload["work_mode"] = "work5rest2"
    payload["demand"] = {
        day: {"morning": 1, "afternoon": 0, "evening": 0}
        for day in payload["days"]
    }

    result = solve_schedule(payload)
    e1_days = {
        row["date"]
        for row in result["assignments"]
        if row["employee_id"] == "e1"
    }
    assert len(e1_days) <= 5


def test_position_demand_never_uses_sales_as_cashier():
    payload = build_payload()
    payload["demand"] = {}
    payload["employees"] = [
        {
            "id": "cashier",
            "name": "收银",
            "position": "cashier",
            "max_weekly_hours": 40,
        },
        {
            "id": "sales",
            "name": "销售",
            "position": "sales",
            "max_weekly_hours": 40,
        },
    ]
    payload["position_demand"] = {
        "2026-07-13": {"morning": {"cashier": 2, "sales": 0}}
    }

    result = solve_schedule(payload)
    gap = next(
        row
        for row in result["gaps"]
        if row["date"] == "2026-07-13" and row["shift"] == "morning"
    )
    assert gap["position"] == "cashier"
    assert gap["shortfall"] == 1


def test_missing_min_rest_uses_four_hours():
    payload = build_payload()
    payload["days"] = ["2026-07-20"]
    payload["employees"] = [
        {
            "id": "e1",
            "name": "小王",
            "position": "sales",
            "max_weekly_hours": 40,
        }
    ]
    payload["demand"] = {
        "2026-07-20": {"morning": 1, "afternoon": 0, "evening": 1}
    }
    payload["preferences"] = []
    payload.pop("min_rest_hours")

    result = solve_schedule(payload)
    shifts = {
        row["shift"]
        for row in result["assignments"]
        if row["employee_id"] == "e1"
    }
    assert shifts == {"morning", "evening"}


def test_invalid_work_mode_is_rejected():
    payload = build_payload()
    payload["work_mode"] = "work7rest0"
    with pytest.raises(ValueError, match="work_mode"):
        solve_schedule(payload)


def test_request_rejects_unknown_shift():
    payload = build_payload()
    payload["shifts"] = ["morning", "night"]
    with pytest.raises(ValidationError):
        SolveRequest(**payload)


def test_request_rejects_unknown_employee_position():
    payload = build_payload()
    payload["employees"][0]["position"] = "chef"
    with pytest.raises(ValidationError):
        SolveRequest(**payload)


def test_request_rejects_partial_position_demand_matrix():
    payload = build_payload()
    payload["position_demand"] = {
        "2026-07-13": {"morning": {"cashier": 1, "sales": 1}}
    }
    with pytest.raises(ValidationError, match="position_demand"):
        SolveRequest(**payload)


def test_closed_day_with_zero_demand_and_all_shifts_unavailable_has_no_work_or_gaps():
    payload = build_payload()
    closed_date = "2026-07-26"
    payload["days"] = [closed_date]
    payload["demand"] = {
        closed_date: {"morning": 0, "afternoon": 0, "evening": 0}
    }
    payload["position_demand"] = {
        closed_date: {
            shift: {"cashier": 0, "sales": 0} for shift in SHIFTS
        }
    }
    for employee in payload["employees"]:
        employee["unavailable"] = [
            {"date": closed_date, "shift": shift} for shift in SHIFTS
        ]
    payload["preferences"] = []

    result = solve_schedule(payload)

    assert result["assignments"] == []
    assert result["gaps"] == []


if __name__ == "__main__":
    test_solver_feasible()
    print("\nOK: 最小测试用例通过")
