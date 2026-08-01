"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Btn, Dialog, PageHeader, Panel, Tag, inputCls } from "@/components/ui";
import { api } from "@/lib/client";
import { currentMonday, mondayOf, toDateStr } from "@/lib/dates";
import type { SchedulePlanSummary, WorkMode } from "@/lib/contracts/scheduling";

type StoreOption = { id: string; name: string; code: string };

const STATUS = {
  draft: { label: "草稿", color: "gray" as const },
  recommended: { label: "已推荐", color: "blue" as const },
  published: { label: "已发布", color: "green" as const },
};

function addDays(date: string, amount: number) {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + amount);
  return toDateStr(value);
}

export default function SchedulePlansPage({
  initialStoreId,
  readOnly,
}: {
  initialStoreId: string | null;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [storeId, setStoreId] = useState(initialStoreId ?? "");
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [plans, setPlans] = useState<SchedulePlanSummary[]>([]);
  const [plansStatus, setPlansStatus] = useState<"loading" | "error" | "rows" | "empty">(initialStoreId ? "loading" : "empty");
  const [plansError, setPlansError] = useState("");
  const [month, setMonth] = useState(currentMonday().slice(0, 7));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<{ weekOf: string; mode: WorkMode }>({
    weekOf: currentMonday(),
    mode: "work5rest2",
  });
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const plansRequestSequence = useRef(0);

  const loadPlans = useCallback(async (scopedStoreId: string) => {
    const requestId = ++plansRequestSequence.current;
    if (!scopedStoreId) {
      setPlans([]);
      setPlansError("");
      setPlansStatus("empty");
      return;
    }
    setPlansStatus("loading");
    setPlansError("");
    try {
      const rows = await api<SchedulePlanSummary[]>(
        `/api/schedule/plans?storeId=${encodeURIComponent(scopedStoreId)}`,
      );
      if (requestId !== plansRequestSequence.current) return;
      setPlans(rows);
      setPlansStatus(rows.length > 0 ? "rows" : "empty");
    } catch (error) {
      if (requestId !== plansRequestSequence.current) return;
      setPlans([]);
      setPlansError(error instanceof Error ? error.message : "排班计划加载失败");
      setPlansStatus("error");
    }
  }, []);

  useEffect(() => {
    if (!readOnly) return;
    let active = true;
    api<StoreOption[]>("/api/store/options")
      .then((options) => {
        if (!active) return;
        setStores(options);
        setStoreId((current) => current || options[0]?.id || "");
      })
      .catch((error: Error) => {
        if (!active) return;
        if (initialStoreId) {
          setMessage(error.message);
        } else {
          plansRequestSequence.current += 1;
          setPlans([]);
          setPlansError(error.message);
          setPlansStatus("error");
        }
      });
    return () => { active = false; };
  }, [initialStoreId, readOnly]);

  useEffect(() => {
    void loadPlans(storeId);
  }, [loadPlans, storeId]);

  const calendarDays = useMemo(() => {
    const [year, monthNumber] = month.split("-").map(Number);
    const first = new Date(year, monthNumber - 1, 1);
    const mondayOffset = (first.getDay() + 6) % 7;
    const start = new Date(first);
    start.setDate(first.getDate() - mondayOffset);
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return toDateStr(date);
    });
  }, [month]);
  const planByWeek = new Map(plans.map((plan) => [plan.weekOf, plan]));

  async function create() {
    setPending(true);
    setMessage("");
    try {
      const plan = await api<SchedulePlanSummary>("/api/schedule/plans", {
        method: "POST",
        body: { storeId, ...form },
      });
      setDialogOpen(false);
      router.push(`/schedule/plans/${plan.id}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <PageHeader
        crumbs={["劳动力管理", "排班管理", "排班计划"]}
        title="排班计划"
        extra={
          !readOnly ? (
            <Btn variant="primary" onClick={() => setDialogOpen(true)}>
              ＋ 新建排班计划
            </Btn>
          ) : undefined
        }
      />
      {message && <div className="text-[12px] text-rose-600">{message}</div>}

      <Panel>
        <div className="p-3 flex items-center gap-3 border-b" style={{ borderColor: "var(--border)" }}>
          {readOnly && (
            <select className={inputCls} value={storeId} onChange={(event) => setStoreId(event.target.value)}>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>{store.name}（{store.code}）</option>
              ))}
            </select>
          )}
          <input aria-label="计划月份" lang="zh-CN" className={inputCls} type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
          <span className="text-[11px] text-gray-400">按周一创建；同一门店同一周只能有一个计划。</span>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-7 border-l border-t" style={{ borderColor: "var(--border)" }}>
            {["周一", "周二", "周三", "周四", "周五", "周六", "周日"].map((label) => (
              <div key={label} className="px-2 py-1.5 text-center text-[11px] text-gray-400 bg-gray-50 border-r border-b" style={{ borderColor: "var(--border)" }}>
                {label}
              </div>
            ))}
            {calendarDays.map((date) => {
              const plan = planByWeek.get(mondayOf(date));
              const inMonth = date.startsWith(month);
              return (
                <div key={date} className={`min-h-16 p-2 border-r border-b ${inMonth ? "bg-white" : "bg-gray-50"}`} style={{ borderColor: "var(--border)" }}>
                  <div className={`text-[11px] ${inMonth ? "text-gray-600" : "text-gray-300"}`}>{date.slice(8)}</div>
                  {plan && date === plan.weekOf && (
                    <Link href={`/schedule/plans/${plan.id}`} className="mt-1 block rounded px-2 py-1 text-[11px] bg-blue-50 text-blue-700 hover:bg-blue-100">
                      {STATUS[plan.status].label} · v{plan.version}
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </Panel>

      <section
        data-testid="schedule-plans-results"
        data-result-state={plansStatus}
        aria-label="排班计划结果"
        aria-busy={plansStatus === "loading"}
        aria-live="polite"
      >
      {plansStatus === "loading" ? <div className="enterprise-state">正在加载排班计划…</div> : plansStatus === "error" ? <div className="enterprise-state text-rose-600" role="alert">{plansError}</div> : <Panel title="计划列表">
        <table className="ent-table">
          <thead><tr><th>计划周</th><th>工作制</th><th>状态</th><th>版本</th><th>发布时间</th><th>操作</th></tr></thead>
          <tbody>
            {plans.length === 0 ? (
              <tr><td colSpan={6} className="py-8 text-center text-gray-400">暂无排班计划</td></tr>
            ) : plans.map((plan) => (
              <tr key={plan.id}>
                <td>{plan.weekOf} ~ {addDays(plan.weekOf, 6)}</td>
                <td>{plan.mode === "work5rest2" ? "做五休二" : "做六休一"}</td>
                <td><Tag color={STATUS[plan.status].color}>{STATUS[plan.status].label}</Tag></td>
                <td>v{plan.version}</td>
                <td>{plan.publishedAt ? plan.publishedAt.slice(0, 16).replace("T", " ") : "—"}</td>
                <td><Link className="text-[var(--primary)]" href={`/schedule/plans/${plan.id}`}>{readOnly ? "查看" : "进入向导"}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>}
      </section>

      <Dialog
        open={dialogOpen}
        title="新建排班计划"
        onClose={() => setDialogOpen(false)}
        footer={<><Btn onClick={() => setDialogOpen(false)}>取消</Btn><Btn variant="primary" disabled={pending} onClick={create}>{pending ? "创建中…" : "创建并进入"}</Btn></>}
      >
        <div className="space-y-4 text-[12px]">
          <label className="block"><span className="mb-1 block text-gray-500">计划周（周一）</span><input aria-label="计划周（周一）" className={`${inputCls} w-full`} type="date" value={form.weekOf} onChange={(event) => setForm({ ...form, weekOf: event.target.value })} /></label>
          <label className="block"><span className="mb-1 block text-gray-500">工作制</span><select aria-label="工作制" className={`${inputCls} w-full`} value={form.mode} onChange={(event) => setForm({ ...form, mode: event.target.value as WorkMode })}><option value="work5rest2">做五休二</option><option value="work6rest1">做六休一</option></select></label>
        </div>
      </Dialog>
    </div>
  );
}
