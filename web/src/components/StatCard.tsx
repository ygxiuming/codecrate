import type { ReactNode } from 'react';
import { Card } from 'antd';

export function StatCard({
  label,
  value,
  foot,
  icon,
}: {
  label: string;
  value: ReactNode;
  foot?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="stat-card">
      <div className="row-between">
        <span className="stat-label">{label}</span>
        {icon ? <span style={{ color: '#8fb7dc', fontSize: 18 }}>{icon}</span> : null}
      </div>
      <div className="stat-value">{value}</div>
      {foot ? <div className="stat-foot">{foot}</div> : null}
    </div>
  );
}

export function AdminCard({
  title,
  extra,
  children,
  bodyStyle,
}: {
  title?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
  bodyStyle?: React.CSSProperties;
}) {
  return (
    <Card
      title={title}
      extra={extra}
      bordered
      style={{ borderColor: '#e6ecf4', boxShadow: '0 4px 14px rgba(16,35,58,0.04)' }}
      styles={{ body: bodyStyle }}
    >
      {children}
    </Card>
  );
}
