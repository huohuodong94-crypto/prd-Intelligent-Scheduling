"use client";

import { useCallback, useEffect, useState } from "react";

import { PageHeader } from "@/components/ui";
import ApprovalCenter from "@/features/approvals/components/ApprovalsPage";
import { api } from "@/lib/client";
import type { ApprovalDecisionInput, ApprovalItem } from "@/lib/contracts/approvals";

export default function ApprovalsRoutePage() {
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [role, setRole] = useState<"manager" | "admin" | null>(null);
  const [storeId, setStoreId] = useState("");
  const [stores, setStores] = useState<Array<{ id: string; name: string }>>([]);
  const [resultsStatus, setResultsStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const load = useCallback(async (explicitStoreId = storeId) => {
    if (role === "admin" && !explicitStoreId) {
      setItems([]);
      setResultsStatus("ready");
      return;
    }
    setResultsStatus("loading");
    setLoadError("");
    const scope = explicitStoreId ? `&storeId=${encodeURIComponent(explicitStoreId)}` : "";
    try {
      const [pending, history] = await Promise.all([
        api<ApprovalItem[]>(`/api/approvals?status=pending${scope}`),
        api<ApprovalItem[]>(`/api/approvals?status=history${scope}`),
      ]);
      setItems([...pending, ...history]);
      setResultsStatus("ready");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "审批记录加载失败");
      setResultsStatus("error");
    }
  }, [role, storeId]);
  useEffect(() => {
    void Promise.all([
      api<{ role: "manager" | "admin"; storeId: string | null }>("/api/auth/me"),
      api<Array<{ id: string; name: string }>>("/api/store/options"),
    ]).then(([me, options]) => {
      setRole(me.role); setStores(options);
      if (me.role === "manager" && me.storeId) { setStoreId(me.storeId); void load(me.storeId); }
      else if (me.role === "admin") setResultsStatus("ready");
    }).catch((error: Error) => {
      setLoadError(error.message);
      setResultsStatus("error");
    });
  // Initial session discovery only; subsequent refreshes use load below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div className="space-y-3">
    <PageHeader crumbs={["劳动力管理", "审批中心"]} title="统一审批中心" extra={role === "admin" ? <select aria-label="选择门店" value={storeId} onChange={(event) => { setStoreId(event.target.value); void load(event.target.value); }} className="rounded border px-2 py-1 text-[12px]"><option value="">请选择门店</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select> : undefined} />
    {role === "admin" && !storeId && <p className="text-[12px] text-amber-700">管理员须明确选择门店后查看审批记录。</p>}
    <section
      data-testid="approvals-results"
      data-result-state={resultsStatus === "ready" ? (items.length > 0 ? "rows" : "empty") : resultsStatus}
      aria-label="审批结果"
      aria-busy={resultsStatus === "loading"}
      aria-live="polite"
    >
      {resultsStatus === "loading" ? <div className="enterprise-state">加载审批记录…</div> : resultsStatus === "error" ? <div role="alert" className="enterprise-state">{loadError}</div> : <ApprovalCenter
        initialItems={items}
        readOnly={role === "admin"}
        onRefresh={() => load()}
        onAiCheck={(item) => api("/api/approvals/ai-check", { method: "POST", body: { type: item.type, id: item.id } })}
        onDecide={(input: ApprovalDecisionInput) => api("/api/approvals/decide", { method: "POST", body: input })}
      />}
    </section>
  </div>;
}
