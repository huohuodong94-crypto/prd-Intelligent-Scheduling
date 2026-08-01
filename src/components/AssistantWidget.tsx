"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, useAsyncAction } from "@/lib/client";

type Msg = {
  role: "user" | "assistant";
  text: string;
  aiLogId?: string;
  retrieved?: Array<{ title: string; score: number }>;
  feedback?: "up" | "down";
};

const SAMPLES = ["我还有多少年假", "怎么申请病假", "去打卡"];

export default function AssistantWidget() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "assistant", text: "你好，我是 WFM 智能助手。可以问我请假、打卡、排班等问题。" },
  ]);
  // 发送防抖交给 useAsyncAction：ref 同步置位，连点/连按回车只会发出一条
  const [send, loading] = useAsyncAction(async (text: string) => {
    if (!text.trim()) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", text }]);
    try {
      const res = await api<{
        reply: string;
        action: { action: string; target: string } | null;
        aiLogId: string;
        retrieved: Array<{ title: string; score: number }>;
      }>("/api/assistant", { method: "POST", body: { message: text } });
      setMsgs((m) => [
        ...m,
        { role: "assistant", text: res.reply, aiLogId: res.aiLogId, retrieved: res.retrieved },
      ]);
      if (res.action?.action === "navigate") {
        setTimeout(() => router.push(res.action!.target), 800);
      }
    } catch (e: any) {
      setMsgs((m) => [...m, { role: "assistant", text: "出错了：" + e.message }]);
    }
  });

  async function feedback(idx: number, kind: "up" | "down") {
    const msg = msgs[idx];
    if (!msg.aiLogId) return;
    await api("/api/ai-feedback", {
      method: "POST",
      body: { aiLogId: msg.aiLogId, wasAccepted: kind === "up" },
    });
    setMsgs((m) => m.map((x, i) => (i === idx ? { ...x, feedback: kind } : x)));
  }

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-6 right-6 w-12 h-12 rounded-full text-white shadow-lg text-[13px] font-medium z-30"
        style={{ background: "var(--primary)" }}
        title="AI 智能助手"
      >
        {open ? "×" : "AI"}
      </button>

      {open && (
        <div
          className="fixed bottom-20 right-6 w-96 max-w-[92vw] h-[520px] bg-white rounded-lg shadow-2xl border flex flex-col z-30"
          style={{ borderColor: "var(--border)" }}
        >
          <div
            className="px-4 py-2.5 border-b flex items-center justify-between text-white rounded-t-lg"
            style={{ background: "var(--nav-bg)" }}
          >
            <span className="text-[13px] font-medium">AI 智能助手</span>
            <span className="text-[11px] text-white/60">真实 LLM + RAG</span>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-3 thin-scroll">
            {msgs.map((m, i) => (
              <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
                <div
                  className={`inline-block px-3 py-2 rounded-lg text-[12px] max-w-[85%] ${
                    m.role === "user" ? "text-white" : "bg-gray-100 text-gray-800"
                  }`}
                  style={m.role === "user" ? { background: "var(--primary)" } : undefined}
                >
                  {m.text}
                </div>
                {m.role === "assistant" && m.retrieved && m.retrieved.length > 0 && (
                  <div className="text-[10px] text-gray-400 mt-1">
                    引用规则：{m.retrieved.map((r) => r.title).join("、")}
                  </div>
                )}
                {m.role === "assistant" && m.aiLogId && (
                  <div className="mt-1 flex gap-2 text-[11px]">
                    <button
                      onClick={() => feedback(i, "up")}
                      className={m.feedback === "up" ? "text-emerald-600" : "text-gray-400"}
                    >
                      👍 有用
                    </button>
                    <button
                      onClick={() => feedback(i, "down")}
                      className={m.feedback === "down" ? "text-rose-500" : "text-gray-400"}
                    >
                      👎 没用
                    </button>
                  </div>
                )}
              </div>
            ))}
            {loading && <div className="text-[11px] text-gray-400">思考中…</div>}
          </div>

          <div className="px-3 pb-2 flex gap-1 flex-wrap">
            {SAMPLES.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                disabled={loading}
                className="text-[11px] border rounded-full px-2 py-1 text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {s}
              </button>
            ))}
          </div>

          <div className="p-3 border-t flex gap-2" style={{ borderColor: "var(--border)" }}>
            <input
              className="flex-1 border rounded px-3 py-2 text-[12px] outline-none focus:border-[var(--primary)]"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send(input)}
              placeholder="输入问题…"
            />
            <button
              onClick={() => send(input)}
              disabled={loading}
              className="text-white rounded px-4 text-[12px] disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: "var(--primary)" }}
            >
              {loading ? "发送中…" : "发送"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
