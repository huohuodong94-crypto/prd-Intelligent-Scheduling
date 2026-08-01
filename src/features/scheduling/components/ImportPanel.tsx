"use client";

import { useState } from "react";

import { Btn } from "@/components/ui";
import { api, apiForm } from "@/lib/client";
import type { ImportValidationResult } from "@/lib/contracts/scheduling";

export type ImportPanelProps = {
  planId: string;
  version: number;
  validation: ImportValidationResult | null;
  onValidated: (result: ImportValidationResult) => void;
  onCommitted: (nextVersion: number) => void;
};

export default function ImportPanel(props: ImportPanelProps) {
  const [progress, setProgress] = useState(0);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function upload(file: File) {
    setPending(true);
    setProgress(20);
    setMessage("");
    const form = new FormData();
    form.set("planId", props.planId);
    form.set("version", String(props.version));
    form.set("file", file);
    try {
      const result = await apiForm<ImportValidationResult>("/api/schedule/import/validate", form);
      setProgress(100);
      props.onValidated(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "校验失败");
    } finally {
      setPending(false);
    }
  }

  async function commit() {
    if (!props.validation || props.validation.errors.length > 0) return;
    setPending(true);
    try {
      const result = await api<{ plan: { version: number } }>("/api/schedule/import/commit", {
        method: "POST",
        body: { batchId: props.validation.batchId, version: props.version },
      });
      props.onCommitted(result.plan.version);
      setMessage("导入完成");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导入失败");
    } finally {
      setPending(false);
    }
  }

  const validation = props.validation;
  return <div className="space-y-3 rounded border bg-white p-4">
    <div className="flex items-center gap-2">
      <a className="rounded border px-3 py-1.5 text-[12px]" href={`/api/schedule/import/template?planId=${encodeURIComponent(props.planId)}`}>下载模板</a>
      <label className="cursor-pointer rounded border px-3 py-1.5 text-[12px]">上传 xlsx<input className="sr-only" type="file" accept=".xlsx" disabled={pending} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} /></label>
      {progress > 0 && <span className="text-[11px] text-gray-500">上传进度 {progress}%</span>}
    </div>
    {validation && <>
      <div className="grid grid-cols-3 gap-2 text-center text-[12px]"><div className="rounded bg-gray-50 p-2">总行数 {validation.totalRows ?? validation.importable + validation.errors.length}</div><div className="rounded bg-emerald-50 p-2 text-emerald-700">可导入 {validation.importable}</div><div className="rounded bg-rose-50 p-2 text-rose-700">错误 {validation.errors.length}</div></div>
      {(validation.errors.length > 0 || validation.warnings.length > 0) && <div className="overflow-x-auto"><table className="ent-table"><thead><tr><th>行</th><th>列</th><th>值</th><th>建议</th></tr></thead><tbody>{[...validation.errors, ...validation.warnings].map((item, index) => <tr key={`${item.code}-${index}`}><td>{item.row}</td><td>{item.column}</td><td>{item.value}</td><td>{item.suggestion}</td></tr>)}</tbody></table></div>}
      <div className="flex justify-end"><Btn variant="primary" disabled={pending || validation.errors.length > 0} onClick={commit}>确认导入</Btn></div>
    </>}
    {message && <div className="text-[12px] text-gray-600">{message}</div>}
  </div>;
}
