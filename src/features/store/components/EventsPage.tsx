"use client";

import { useState } from "react";
import { ActionToolbar, Dialog, QueryBar } from "@/components/enterprise";
import { api } from "@/lib/client";
import type { StoreEventInput, StoreOption } from "@/lib/contracts/store";

const EVENT_META = {
  promo: { name: "促销", factor: 1.3 },
  new_arrival: { name: "新品", factor: 1.15 },
  holiday: { name: "节假日", factor: 1.4 },
} as const;
type EventLabel = keyof typeof EVENT_META;

export type EventsPageProps = {
  sessionStoreId: string | null;
  readOnly: boolean;
  storeOptions?: StoreOption[];
  initialStoreId?: string;
  initialMonth: string;
  initialEvents?: StoreEventInput[];
  onToggle?: (event: StoreEventInput) => Promise<void>;
};

type MonthCalendarProps = {
  month: string;
  events: StoreEventInput[];
  readOnly: boolean;
  compact?: boolean;
  onSelect?: (date: string) => void;
};

function dateKey(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function MonthCalendar({ month, events, readOnly, compact = false, onSelect }: MonthCalendarProps) {
  const [year, monthNumber] = month.split("-").map(Number);
  const firstDay = new Date(year, monthNumber - 1, 1).getDay();
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const cells = Array.from({ length: firstDay + daysInMonth }, (_, index) =>
    index < firstDay ? null : index - firstDay + 1
  );
  const eventMap = new Map<string, StoreEventInput[]>();
  for (const event of events) eventMap.set(event.date, [...(eventMap.get(event.date) ?? []), event]);

  return (
    <section className="border bg-white p-2" style={{ borderColor: "var(--border)" }}>
      <h3 className="mb-2 text-[12px] font-medium">{year} 年 {monthNumber} 月</h3>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-[var(--text-muted)]">
        {["日", "一", "二", "三", "四", "五", "六"].map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((day, index) => {
          if (day === null) return <span key={`empty-${index}`} />;
          const key = dateKey(year, monthNumber, day);
          const dayEvents = eventMap.get(key) ?? [];
          const content = (
            <>
              <span>{day}</span>
              {dayEvents.slice(0, compact ? 1 : 2).map((event) => (
                <span key={event.label} className="mt-0.5 block truncate text-[9px] text-[var(--primary)]">{EVENT_META[event.label].name}</span>
              ))}
            </>
          );
          return readOnly ? (
            <div key={key} aria-label={key} className={`${compact ? "min-h-7" : "min-h-14"} border p-1 text-[10px]`} style={{ borderColor: "var(--border)" }}>{content}</div>
          ) : (
            <button key={key} aria-label={key} type="button" className={`${compact ? "min-h-7" : "min-h-14"} border p-1 text-left text-[10px] hover:bg-[var(--primary-weak)]`} style={{ borderColor: "var(--border)" }} onClick={() => onSelect?.(key)}>{content}</button>
          );
        })}
      </div>
    </section>
  );
}

function navigate(storeId: string, month: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("storeId", storeId);
  url.searchParams.set("month", month);
  window.location.assign(url.toString());
}

export default function EventsPage({
  sessionStoreId,
  readOnly,
  storeOptions = [],
  initialStoreId,
  initialMonth,
  initialEvents = [],
  onToggle,
}: EventsPageProps) {
  const selectedStoreId = initialStoreId ?? sessionStoreId ?? storeOptions[0]?.id ?? "";
  const [month, setMonth] = useState(initialMonth);
  const [events, setEvents] = useState(initialEvents);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<EventLabel>("promo");
  const [message, setMessage] = useState("");
  const year = Number(initialMonth.slice(0, 4));

  async function toggle() {
    if (!selectedDate) return;
    const input: StoreEventInput = {
      date: selectedDate,
      label: selectedLabel,
      factor: EVENT_META[selectedLabel].factor,
    };
    if (onToggle) await onToggle(input);
    else {
      const existing = events.some((event) => event.date === input.date && event.label === input.label);
      await api("/api/store/events", {
        method: existing ? "DELETE" : "POST",
        body: { storeId: selectedStoreId, ...input },
      });
    }
    setEvents((current) => {
      const exists = current.some((event) => event.date === input.date && event.label === input.label);
      return exists
        ? current.filter((event) => event.date !== input.date || event.label !== input.label)
        : [...current, input];
    });
    setSelectedDate(null);
    setMessage("活动日历已更新");
  }

  return (
    <div className="space-y-3">
      <div><h1 className="text-[18px] font-semibold">活动日历</h1><p className="mt-1 text-[12px] text-[var(--text-muted)]">活动日期按本地 YYYY-MM-DD 保存，不经过 UTC 截断</p></div>
      <QueryBar>
        <label className="flex items-center gap-2 text-[12px]">门店<select aria-label="门店" className="enterprise-control border px-2" value={selectedStoreId} onChange={(event) => navigate(event.target.value, month)}>{storeOptions.map((option) => <option key={option.id} value={option.id}>{option.name}（{option.code}）</option>)}</select></label>
        {!readOnly && <label className="flex items-center gap-2 text-[12px]">月份<input aria-label="月份" className="enterprise-control border px-2" type="month" value={month} onChange={(event) => { setMonth(event.target.value); navigate(selectedStoreId, event.target.value); }} /></label>}
      </QueryBar>
      <ActionToolbar end={message && <span className="text-[12px] text-emerald-600">{message}</span>}>
        <span className="text-[12px] text-[var(--text-muted)]">{readOnly ? "系统管理员只读年视图" : "点击日期切换活动标签"}</span>
      </ActionToolbar>

      {readOnly ? (
        <div aria-label={`${year} 年活动日历`} className="grid grid-cols-3 gap-3">
          {Array.from({ length: 12 }, (_, index) => (
            <MonthCalendar key={index} month={`${year}-${String(index + 1).padStart(2, "0")}`} events={events} readOnly compact />
          ))}
        </div>
      ) : (
        <MonthCalendar month={month} events={events} readOnly={false} onSelect={setSelectedDate} />
      )}

      <Dialog
        open={selectedDate !== null}
        title="设置活动"
        onClose={() => setSelectedDate(null)}
        footer={<button className="enterprise-primary-button" type="button" onClick={toggle}>确认切换</button>}
      >
        <div className="space-y-3 text-[12px]">
          <p>日期：{selectedDate}</p>
          <label>活动类型<select aria-label="活动类型" className="enterprise-control ml-2 border px-2" value={selectedLabel} onChange={(event) => setSelectedLabel(event.target.value as EventLabel)}>{Object.entries(EVENT_META).map(([value, meta]) => <option key={value} value={value}>{meta.name}（×{meta.factor}）</option>)}</select></label>
        </div>
      </Dialog>
    </div>
  );
}
