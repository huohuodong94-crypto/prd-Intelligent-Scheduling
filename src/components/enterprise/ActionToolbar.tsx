import type { ReactNode } from "react";

export type ActionToolbarProps = {
  children: ReactNode;
  end?: ReactNode;
};

export default function ActionToolbar({ children, end }: ActionToolbarProps) {
  return (
    <div className="enterprise-action-toolbar">
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      {end && <div className="ml-auto flex items-center gap-2">{end}</div>}
    </div>
  );
}
