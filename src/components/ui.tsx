"use client";

import React from "react";

// ---- 页面头部：面包屑 + 标题（对标劳勤 Tab 工作区顶部） ----
export function PageHeader({
  crumbs,
  title,
  extra,
}: {
  crumbs: string[];
  title: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="mb-3">
      <div className="mb-1 text-[12px] text-[var(--text-muted)]">{crumbs.join(" / ")}</div>
      <div className="flex items-center justify-between">
        <h1 className="text-[16px] font-semibold text-gray-800">{title}</h1>
        {extra}
      </div>
    </div>
  );
}

// ---- 白色面板卡片 ----
export function Panel({
  children,
  className = "",
  title,
  toolbar,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
  toolbar?: React.ReactNode;
}) {
  return (
    <div
      className={`bg-white rounded border ${className}`}
      style={{ borderColor: "var(--border)" }}
    >
      {(title || toolbar) && (
        <div
          className="flex items-center justify-between px-4 py-2.5 border-b"
          style={{ borderColor: "var(--border)" }}
        >
          {title && (
            <div className="text-[13px] font-medium text-gray-700 flex items-center gap-2">
              <span className="w-1 h-3.5 rounded" style={{ background: "var(--primary)" }} />
              {title}
            </div>
          )}
          {toolbar}
        </div>
      )}
      {children}
    </div>
  );
}

// ---- 筛选工具条（组织 / 日期 / 人员 / 更多操作） ----
export function FilterBar({
  children,
  right,
}: {
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div
      className="flex items-center gap-2 flex-wrap px-3 py-2.5 bg-white rounded border mb-3"
      style={{ borderColor: "var(--border)" }}
    >
      {children}
      <div className="ml-auto flex items-center gap-2">{right}</div>
    </div>
  );
}

export function Btn({
  children,
  onClick,
  variant = "default",
  disabled,
  size = "md",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "ghost" | "success" | "danger";
  disabled?: boolean;
  size?: "sm" | "md";
}) {
  const base =
    "inline-flex items-center justify-center rounded text-[12px] transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const sz = size === "sm" ? "px-2.5 py-1" : "px-3.5 py-1.5";
  const styles: Record<string, string> = {
    default: "border text-gray-600 hover:bg-gray-50 bg-white",
    primary: "text-white",
    ghost: "text-[var(--primary)] hover:bg-[var(--primary-weak)]",
    success: "text-white bg-emerald-600 hover:bg-emerald-700",
    danger: "text-white bg-rose-500 hover:bg-rose-600",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${sz} ${styles[variant]}`}
      style={
        variant === "primary"
          ? { background: "var(--primary)" }
          : variant === "default"
          ? { borderColor: "var(--border)" }
          : undefined
      }
    >
      {children}
    </button>
  );
}

// ---- 分页脚（共 X 条 · 页码 · 31条/页） ----
export function Pagination({ total }: { total: number }) {
  return (
    <div
      className="flex items-center justify-end gap-3 px-4 py-2 border-t text-[12px] text-gray-500"
      style={{ borderColor: "var(--border)" }}
    >
      <span>共 {total} 条</span>
      <span className="flex items-center gap-1">
        <button className="w-6 h-6 border rounded text-gray-400" disabled>
          ‹
        </button>
        <button
          className="w-6 h-6 border rounded text-white"
          style={{ background: "var(--primary)", borderColor: "var(--primary)" }}
        >
          1
        </button>
        <button className="w-6 h-6 border rounded text-gray-400" disabled>
          ›
        </button>
      </span>
      <span>31 条/页</span>
    </div>
  );
}

// ---- 四步向导（排班准备→业务预测→人力预测→自动排班） ----
export function StepBar({ steps, active }: { steps: string[]; active: number }) {
  return (
    <div className="flex items-center gap-1 text-[13px]">
      {steps.map((s, i) => {
        const done = i < active;
        const cur = i === active;
        return (
          <React.Fragment key={s}>
            <div className="flex items-center gap-2">
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] ${
                  done || cur ? "text-white" : "text-gray-400 bg-gray-200"
                }`}
                style={done || cur ? { background: "var(--primary)" } : undefined}
              >
                {done ? "✓" : i + 1}
              </span>
              <span className={cur ? "text-[var(--primary)] font-medium" : "text-gray-500"}>
                {s}
              </span>
            </div>
            {i < steps.length - 1 && <span className="w-10 h-px bg-gray-300 mx-1" />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ---- 班次色块样式（对标劳勤排班网格：早绿/午黄/晚蓝/休灰） ----
export const SHIFT_STYLE: Record<
  string,
  { bg: string; border: string; text: string; label: string; time: string }
> = {
  morning: { bg: "#e6f6ea", border: "#8bcb95", text: "#1c7a35", label: "早班", time: "09:00-13:00" },
  afternoon: { bg: "#fdf3d6", border: "#e6c258", text: "#8a6a15", label: "午班", time: "13:00-17:00" },
  evening: { bg: "#e3ecfb", border: "#8fb2e8", text: "#1f4f9e", label: "晚班", time: "17:00-21:00" },
};

export function ShiftBlock({ shift }: { shift: string }) {
  const s = SHIFT_STYLE[shift];
  if (!s)
    return (
      <div className="text-[11px] text-gray-300 py-2 text-center">OFF / 休</div>
    );
  return (
    <div
      className="rounded px-1.5 py-1 text-[11px] leading-tight border"
      style={{ background: s.bg, borderColor: s.border, color: s.text }}
    >
      <div className="font-medium">{s.label}</div>
      <div className="opacity-80">{s.time} 4H</div>
    </div>
  );
}

export function Tag({
  children,
  color = "gray",
}: {
  children: React.ReactNode;
  color?: "gray" | "amber" | "green" | "red" | "blue";
}) {
  const map: Record<string, string> = {
    gray: "bg-gray-100 text-gray-500",
    amber: "bg-amber-50 text-amber-600",
    green: "bg-emerald-50 text-emerald-600",
    red: "bg-rose-50 text-rose-500",
    blue: "bg-blue-50 text-blue-600",
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[11px] ${map[color]}`}>
      {children}
    </span>
  );
}

export const inputCls =
  "border rounded px-2 py-1 text-[12px] outline-none focus:border-[var(--primary)]";

export {
  ActionToolbar,
  AsyncBoundary,
  Dialog,
  Drawer,
  EnterpriseTable,
  QueryBar,
  StatusTag,
} from "./enterprise";
export type {
  AsyncBoundaryProps,
  EnterpriseColumn,
} from "./enterprise";
