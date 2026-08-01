import type { ReactNode } from "react";

export type AsyncBoundaryProps = {
  loading: boolean;
  error?: string | null;
  empty: boolean;
  onRetry?: () => void;
  children: ReactNode;
};

export default function AsyncBoundary({
  loading,
  error,
  empty,
  onRetry,
  children,
}: AsyncBoundaryProps) {
  if (loading) return <div className="enterprise-state">加载中…</div>;
  if (error)
    return (
      <div className="enterprise-state" role="alert">
        <span>{error}</span>
        {onRetry && <button type="button" className="enterprise-primary-button" onClick={onRetry}>重试</button>}
      </div>
    );
  if (empty) return <div className="enterprise-state">暂无数据</div>;
  return <>{children}</>;
}
