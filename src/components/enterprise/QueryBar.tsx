import type { ReactNode } from "react";

export type QueryBarProps = {
  children: ReactNode;
  actions?: ReactNode;
};

export default function QueryBar({ children, actions }: QueryBarProps) {
  return (
    <section className="enterprise-query-bar" aria-label="查询条件">
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </section>
  );
}
