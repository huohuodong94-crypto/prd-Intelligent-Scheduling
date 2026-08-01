"""
排班优化引擎 REST 服务（FastAPI）。

被 Node 后端通过 POST /solve-schedule 调用。
这一层是排班的唯一计算来源，不含任何 LLM 调用。
（使用 typing.Optional/List 以兼容 Python 3.9）
"""

from typing import Any, Dict, List, Literal, Optional

from fastapi import FastAPI
from pydantic import BaseModel, Field, model_validator

from solver import solve_schedule

app = FastAPI(title="WFM Schedule Optimization Engine", version="0.1.0")

Shift = Literal["morning", "afternoon", "evening"]
Position = Literal["cashier", "sales"]
FIXED_SHIFTS = ["morning", "afternoon", "evening"]
POSITIONS = {"cashier", "sales"}


class Unavailable(BaseModel):
    date: str
    shift: Shift


class Employee(BaseModel):
    id: str
    name: Optional[str] = None
    position: Position
    max_weekly_hours: Optional[float] = None
    last_week_hours: float = 0
    unavailable: List[Unavailable] = Field(default_factory=list)


class Preference(BaseModel):
    employee_id: str
    shift: Shift
    weight: str = "soft"


class SolveRequest(BaseModel):
    week_of: str
    days: List[str]
    shifts: List[Shift] = Field(default_factory=lambda: list(FIXED_SHIFTS))
    demand: Dict[str, Dict[Shift, int]] = Field(default_factory=dict)
    position_demand: Dict[str, Dict[Shift, Dict[Position, int]]] = Field(default_factory=dict)
    employees: List[Employee]
    work_mode: Literal["work5rest2", "work6rest1"] = "work5rest2"
    shift_hours: float = 4
    min_rest_hours: float = 4
    max_weekly_hours: float = 40
    preferences: List[Preference] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_fixed_shifts_and_position_matrix(self) -> "SolveRequest":
        if self.shifts != FIXED_SHIFTS:
            raise ValueError("shifts must be morning, afternoon, evening")
        if not self.position_demand:
            return self
        if set(self.position_demand) != set(self.days):
            raise ValueError("position_demand must cover every requested day")
        for day in self.days:
            by_shift = self.position_demand[day]
            if set(by_shift) != set(FIXED_SHIFTS):
                raise ValueError(
                    f"position_demand[{day}] must cover every fixed shift"
                )
            for shift in FIXED_SHIFTS:
                if set(by_shift[shift]) != POSITIONS:
                    raise ValueError(
                        f"position_demand[{day}][{shift}] must cover cashier and sales"
                    )
        return self


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok", "service": "schedule-engine"}


@app.post("/solve-schedule")
def solve(req: SolveRequest) -> Dict[str, Any]:
    payload = req.model_dump()
    return solve_schedule(payload)
