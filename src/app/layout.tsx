import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WFM 智能排班系统",
  description: "零售连锁门店智能排班 WFM MVP",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
