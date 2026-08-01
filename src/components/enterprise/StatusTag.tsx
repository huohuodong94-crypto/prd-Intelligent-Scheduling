import type { ReactNode } from "react";

export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info";

export const STATUS_TAG_COLORS: Record<StatusTone, { color: string; background: string }> = {
  neutral: { color: "var(--text-muted)", background: "#ECEFF3" },
  success: { color: "#17633F", background: "#E5F4EC" },
  warning: { color: "#895600", background: "#FFF1D9" },
  danger: { color: "#9F2424", background: "#FCE6E6" },
  info: { color: "var(--primary)", background: "#E3F4F8" },
};

export default function StatusTag({ children, tone = "neutral" }: { children: ReactNode; tone?: StatusTone }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 text-[11px]" style={{ ...STATUS_TAG_COLORS[tone], borderRadius: 999 }}>
      {children}
    </span>
  );
}
