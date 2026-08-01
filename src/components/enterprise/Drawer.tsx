"use client";

import type { MouseEvent, ReactNode } from "react";
import { useModalFocus } from "./useModalFocus";

export type DrawerProps = {
  open: boolean;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
};

export default function Drawer({ open, title, children, footer, onClose }: DrawerProps) {
  const { layerRef, onKeyDown } = useModalFocus(open, onClose);
  if (!open) return null;

  function closeOnBackdrop(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onClose();
  }

  return (
    <div className="enterprise-overlay justify-end" role="presentation" onMouseDown={closeOnBackdrop}>
      <section ref={layerRef} tabIndex={-1} onKeyDown={onKeyDown} className="enterprise-drawer" role="dialog" aria-modal="true" aria-label={title}>
        <header className="enterprise-layer-header">
          <h2>{title}</h2>
          <button type="button" aria-label="关闭" onClick={onClose}>×</button>
        </header>
        <div className="thin-scroll flex-1 overflow-y-auto p-4">{children}</div>
        {footer && <footer className="enterprise-layer-footer">{footer}</footer>}
      </section>
    </div>
  );
}
