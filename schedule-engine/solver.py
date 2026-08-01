"""
排班优化引擎核心求解逻辑（Google OR-Tools CP-SAT）。

设计要点（严格对齐需求文档 4.1 优化引擎层）：
- 排班是约束优化问题，绝对不让 LLM 参与实际计算，这里是唯一的求解器。
- 硬约束：
    1. 请假期间不可排班（unavailable 直接置 0）
    2. 每人每周工时不超过上限（默认 40h，可配置）
    3. 两班之间最小休息间隔（默认 4h）——按班次真实起止时间判定
- 软约束 / 目标（词典序，用大权重近似）：
    1. 首要：满足每个时段的所需人数；无法满足时用缺口变量吸收，返回缺口提示而非硬报错
    2. 次要：满足 LLM 解析出的员工班次偏好（软约束）
    3. 再次：公平性——上周工时越多的员工，本周尽量少排（打散工时）
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from ortools.sat.python import cp_model

# 班次 → (开始小时, 结束小时)。与前端/需求一致：三班各 4 小时。
SHIFT_TIMES = {
    "morning": (9, 13),
    "afternoon": (13, 17),
    "evening": (17, 21),
}


def _shift_start_end(date_str: str, shift: str) -> tuple[datetime, datetime]:
    start_h, end_h = SHIFT_TIMES[shift]
    base = datetime.strptime(date_str, "%Y-%m-%d")
    return base + timedelta(hours=start_h), base + timedelta(hours=end_h)


def solve_schedule(payload: dict[str, Any]) -> dict[str, Any]:
    """求解一周排班。输入/输出为纯 dict（JSON 友好）。"""
    days: list[str] = payload["days"]
    shifts: list[str] = payload.get("shifts", ["morning", "afternoon", "evening"])
    demand: dict[str, dict[str, int]] = payload.get("demand", {})
    position_demand: dict[str, dict[str, dict[str, int]]] = payload.get(
        "position_demand", {}
    )
    employees: list[dict[str, Any]] = payload["employees"]
    work_mode: str = payload.get("work_mode", "work5rest2")
    if work_mode not in {"work5rest2", "work6rest1"}:
        raise ValueError(f"unsupported work_mode: {work_mode}")

    shift_hours: float = float(payload.get("shift_hours", 4))
    min_rest_hours: float = float(payload.get("min_rest_hours", 4))
    default_max_weekly: float = float(payload.get("max_weekly_hours", 40))
    preferences: list[dict[str, Any]] = payload.get("preferences", [])

    model = cp_model.CpModel()

    # 决策变量 x[e, d, s] ∈ {0,1}：员工 e 在 d 日 s 班次是否上班
    x: dict[tuple[str, str, str], cp_model.IntVar] = {}
    for e in employees:
        for d in days:
            for s in shifts:
                x[(e["id"], d, s)] = model.NewBoolVar(f"x_{e['id']}_{d}_{s}")

    # 硬约束 1：请假不可排班
    for e in employees:
        unavailable = {
            (u["date"], u["shift"]) for u in e.get("unavailable", [])
        }
        for d in days:
            for s in shifts:
                if (d, s) in unavailable:
                    model.Add(x[(e["id"], d, s)] == 0)

    # 硬约束 2：每人每周工时不超过上限
    for e in employees:
        max_hours = float(e.get("max_weekly_hours") or default_max_weekly)
        max_shifts = int(max_hours // shift_hours)
        model.Add(
            sum(x[(e["id"], d, s)] for d in days for s in shifts) <= max_shifts
        )

    # 硬约束 3：工作制限制每周实际工作的不同日期数。
    max_work_days = 6 if work_mode == "work6rest1" else 5
    worked: dict[tuple[str, str], cp_model.IntVar] = {}
    for e in employees:
        for d in days:
            worked[(e["id"], d)] = model.NewBoolVar(f"worked_{e['id']}_{d}")
            model.AddMaxEquality(
                worked[(e["id"], d)],
                [x[(e["id"], d, s)] for s in shifts],
            )
        model.Add(sum(worked[(e["id"], d)] for d in days) <= max_work_days)

    # 硬约束 4：两班最小休息间隔（按真实起止时间，任意两个被排班次间隔需 >= min_rest）
    for e in employees:
        slots = [(d, s) for d in days for s in shifts]
        times = {
            (d, s): _shift_start_end(d, s) for (d, s) in slots
        }
        for i in range(len(slots)):
            for j in range(i + 1, len(slots)):
                (d1, s1), (d2, s2) = slots[i], slots[j]
                start1, end1 = times[(d1, s1)]
                start2, end2 = times[(d2, s2)]
                # 计算两个班次之间的空档（小时）
                if start1 <= start2:
                    gap = (start2 - end1).total_seconds() / 3600
                else:
                    gap = (start1 - end2).total_seconds() / 3600
                if gap < min_rest_hours:
                    # 二者不能同时被排给同一员工
                    model.Add(
                        x[(e["id"], d1, s1)] + x[(e["id"], d2, s2)] <= 1
                    )

    # 软约束 1：满足人数需求（缺口变量吸收无法满足的部分）
    shortage_vars: list[cp_model.IntVar] = []
    gaps: list[dict[str, Any]] = []
    if position_demand:
        for d in days:
            for s in shifts:
                for position, raw_required in position_demand.get(d, {}).get(s, {}).items():
                    required = int(raw_required)
                    if required <= 0:
                        continue
                    assigned = sum(
                        x[(e["id"], d, s)]
                        for e in employees
                        if e.get("position") == position
                    )
                    short = model.NewIntVar(
                        0, required, f"short_{d}_{s}_{position}"
                    )
                    model.Add(assigned + short >= required)
                    shortage_vars.append(short)
                    gaps.append(
                        {
                            "date": d,
                            "shift": s,
                            "position": position,
                            "required": required,
                            "var": short,
                        }
                    )
    else:
        for d in days:
            for s in shifts:
                required = int(demand.get(d, {}).get(s, 0))
                if required <= 0:
                    continue
                assigned = sum(x[(e["id"], d, s)] for e in employees)
                short = model.NewIntVar(0, required, f"short_{d}_{s}")
                model.Add(assigned + short >= required)
                shortage_vars.append(short)
                gaps.append(
                    {"date": d, "shift": s, "required": required, "var": short}
                )

    # 软约束 2：LLM 偏好（尽量满足指定员工的指定班次）
    pref_terms: list[cp_model.IntVar] = []
    for p in preferences:
        eid = p.get("employee_id")
        pref_shift = p.get("shift")
        if eid is None or pref_shift not in shifts:
            continue
        for d in days:
            key = (eid, d, pref_shift)
            if key in x:
                pref_terms.append(x[key])

    # 目标：词典序权重。缺口权重最大 > 公平性 > 偏好
    W_SHORTAGE = 100000
    W_FAIRNESS = 10
    W_PREF = 100

    fairness_terms = []
    for e in employees:
        last = float(e.get("last_week_hours") or 0)
        weight = int(last)  # 上周工时越多，本周每多排一班惩罚越大
        for d in days:
            for s in shifts:
                if weight > 0:
                    fairness_terms.append(weight * x[(e["id"], d, s)])

    objective = W_SHORTAGE * sum(shortage_vars)
    if fairness_terms:
        objective += W_FAIRNESS * sum(fairness_terms)
    if pref_terms:
        objective -= W_PREF * sum(pref_terms)
    model.Minimize(objective)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 10.0
    status = solver.Solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {
            "status": "infeasible",
            "message": "求解器未能找到可行解",
            "assignments": [],
            "gaps": [],
        }

    assignments: list[dict[str, Any]] = []
    for e in employees:
        for d in days:
            for s in shifts:
                if solver.Value(x[(e["id"], d, s)]) == 1:
                    assignments.append(
                        {"employee_id": e["id"], "date": d, "shift": s}
                    )

    reported_gaps = []
    for g in gaps:
        shortfall = solver.Value(g["var"])
        if shortfall > 0:
            reported = {
                "date": g["date"],
                "shift": g["shift"],
                "required": g["required"],
                "shortfall": shortfall,
            }
            if "position" in g:
                reported["position"] = g["position"]
            reported_gaps.append(reported)

    return {
        "status": "feasible" if not reported_gaps else "feasible_with_gaps",
        "message": "求解成功" if not reported_gaps else "已求解，但部分时段人数存在缺口",
        "objective": solver.ObjectiveValue(),
        "solve_time_ms": int(solver.WallTime() * 1000),
        "assignments": assignments,
        "gaps": reported_gaps,
    }
