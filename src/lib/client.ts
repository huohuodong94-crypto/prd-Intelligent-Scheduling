"use client";

import { useCallback, useRef, useState } from "react";
import type { ScheduleAssignment, ScheduleCell } from "./contracts/scheduling";

export class ApiError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

type ApiResponse<T> = {
  ok?: boolean;
  data?: T;
  error?: string;
  details?: unknown;
};

async function unwrapResponse<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => ({}))) as ApiResponse<T>;
  if (!res.ok || json.ok === false) {
    throw new ApiError(
      json.error || `请求失败 (${res.status})`,
      res.status,
      json.details
    );
  }
  return json.data as T;
}

// 客户端统一请求封装（不引入任何服务端模块）。
export async function api<T = any>(
  path: string,
  opts?: { method?: string; body?: unknown; signal?: AbortSignal }
): Promise<T> {
  const hasBody = opts?.body !== undefined;
  const res = await fetch(path, {
    method: opts?.method || "GET",
    headers: hasBody ? { "content-type": "application/json" } : undefined,
    body: hasBody ? JSON.stringify(opts?.body) : undefined,
    signal: opts?.signal,
  });
  return unwrapResponse<T>(res);
}

export async function apiForm<T>(path: string, body: FormData): Promise<T> {
  const res = await fetch(path, { method: "POST", body });
  return unwrapResponse<T>(res);
}

// 请求态防抖：以「请求是否在途」为准，不用 setTimeout 假防抖。
// 用 ref 同步置位而非只靠 state —— setState 是异步的，同一轮渲染内的连点
// 会全部读到旧的 pending=false 从而绕过判断；ref 在第一次调用时立即生效。
export function useAsyncAction<A extends unknown[]>(
  fn: (...args: A) => Promise<void>
) {
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  // 保存最新的 fn，避免把它写进 useCallback 依赖导致 run 每次渲染都变
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async (...args: A) => {
    if (inFlight.current) return; // 已有同类请求在途，直接丢弃本次点击
    inFlight.current = true;
    setPending(true);
    try {
      await fnRef.current(...args);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }, []);

  return [run, pending] as const;
}

export const SHIFT_LABELS: Record<string, string> = {
  morning: "早班",
  afternoon: "午班",
  evening: "晚班",
};

export const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

// 岗位标签（客户端副本，服务端见 config.ts 的 POSITION_LABELS）
export const POSITION_LABELS: Record<string, string> = {
  cashier: "收银",
  sales: "销售",
};

export function assignmentsToCells(assignments: ScheduleAssignment[]): ScheduleCell[] {
  const cells = new Map<string, ScheduleCell>();
  for (const assignment of assignments) {
    const key = `${assignment.userId}\u0000${assignment.date}`;
    const cell = cells.get(key) ?? { userId: assignment.userId, date: assignment.date, shifts: [] };
    if (!cell.shifts.includes(assignment.shiftType)) cell.shifts.push(assignment.shiftType);
    cells.set(key, cell);
  }
  return [...cells.values()];
}

export function cellsToAssignments(cells: ScheduleCell[]): ScheduleAssignment[] {
  return cells.flatMap((cell) =>
    cell.shifts.map((shiftType) => ({ userId: cell.userId, date: cell.date, shiftType })),
  );
}
