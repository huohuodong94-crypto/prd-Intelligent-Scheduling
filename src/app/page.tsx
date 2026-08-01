"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";

const DEMO_ACCOUNTS = [
  { phone: "13900000000", label: "系统管理员" },
  { phone: "13800000001", label: "望京店经理·李经理" },
  { phone: "13810000001", label: "望京店员工·小王" },
  { phone: "13800000002", label: "中关村店经理·王经理" },
];

type LoginResult = { role: "employee" | "manager" | "admin" };

export default function LoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("13800000001");
  const [code, setCode] = useState("123456");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      const user = await api<LoginResult>("/api/auth/login", {
        method: "POST",
        body: { phone, code },
      });
      router.push(user.role === "admin" ? "/admin/demand" : "/dashboard");
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  function sendCode() {
    setCode("123456");
    setSent(true);
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{
        background:
          "linear-gradient(135deg, #1e63c4 0%, #2f9bd6 55%, #37c0c9 100%)",
      }}
    >
      <div
        data-testid="login-card"
        className="w-full max-w-lg overflow-hidden rounded-lg bg-white shadow-2xl"
      >
        <div className="p-8">
          <div className="mb-6 text-center">
            <h1 className="text-3xl font-bold tracking-widest text-gray-700">WFM</h1>
            <div className="mt-1 text-[12px] text-gray-400">智能排班系统 · 登录到您的账户</div>
          </div>

          <form aria-label="登录账户" onSubmit={submit} className="space-y-4">
            <div>
              <label htmlFor="login-phone" className="block text-[12px] text-gray-500 mb-1">手机号</label>
              <input
                id="login-phone"
                className="w-full border rounded px-3 py-2 text-[13px] outline-none focus:border-[var(--primary)]"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="请输入手机号"
              />
            </div>
            <div>
              <label htmlFor="login-code" className="block text-[12px] text-gray-500 mb-1">验证码</label>
              <div className="flex gap-2">
                <input
                  id="login-code"
                  className="flex-1 border rounded px-3 py-2 text-[13px] outline-none focus:border-[var(--primary)]"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="请输入验证码"
                />
                <button
                  type="button"
                  onClick={sendCode}
                  className="px-3 rounded text-white text-[12px] whitespace-nowrap"
                  style={{ background: "var(--primary)" }}
                >
                  {sent ? "已发送" : "发送验证码"}
                </button>
              </div>
              <div className="text-[11px] text-gray-400 mt-1">
                MVP 验证码固定为 123456（不接真实短信）
              </div>
            </div>
            {err && <p className="text-[12px] text-rose-500">{err}</p>}
            <button
              disabled={loading}
              className="w-full text-white rounded py-2 text-[14px] font-medium disabled:opacity-50"
              style={{ background: "var(--primary)" }}
            >
              {loading ? "登录中…" : "登录"}
            </button>
          </form>

          <div className="mt-5">
            <p className="text-[11px] text-gray-400 mb-2">快速选择测试账号：</p>
            <div className="grid grid-cols-2 gap-2">
              {DEMO_ACCOUNTS.map((a) => (
                <button
                  key={a.phone}
                  onClick={() => setPhone(a.phone)}
                  className="text-[11px] border rounded px-2 py-1.5 text-left hover:bg-gray-50"
                >
                  <div className="font-medium text-gray-700">{a.label}</div>
                  <div className="text-gray-400">{a.phone}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
