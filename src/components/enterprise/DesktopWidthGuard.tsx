"use client";

import { useEffect, useState } from "react";

export default function DesktopWidthGuard({ children }: { children: React.ReactNode }) {
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(max-width: 1279px)");
    const update = () => setBlocked(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  if (blocked) {
    return (
      <div
        role="alert"
        style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#F3F5F7", color: "#273648", fontSize: 16 }}
      >
        请使用宽屏浏览器访问（最低 1280px）
      </div>
    );
  }

  return <div data-testid="desktop-shell" style={{ minWidth: 1280 }}>{children}</div>;
}
