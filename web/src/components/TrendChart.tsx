import type { TimeseriesPoint } from '../api/types';

const METRICS = [
  { key: 'pv', label: '浏览量 PV', color: '#0078d4' },
  { key: 'uv', label: '访客数 UV', color: '#16a34a' },
  { key: 'downloads', label: '下载量', color: '#f59e0b' },
  { key: 'clicks', label: '点击事件', color: '#8b5cf6' },
] as const;

type MetricKey = (typeof METRICS)[number]['key'];

interface Props {
  points: TimeseriesPoint[];
  active?: MetricKey[];
}

export function TrendChart({ points, active = ['pv', 'uv', 'downloads'] }: Props) {
  const metrics = METRICS.filter((metric) => active.includes(metric.key));
  const width = 760;
  const height = 250;
  const padding = { top: 18, right: 16, bottom: 34, left: 44 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const max = Math.max(
    1,
    ...points.flatMap((point) => metrics.map((metric) => point[metric.key] as number)),
  );
  const stepX = points.length > 1 ? innerWidth / (points.length - 1) : 0;
  const y = (value: number): number => padding.top + innerHeight - (value / max) * innerHeight;
  const x = (index: number): number => padding.left + index * stepX;

  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const labelStep = Math.max(1, Math.ceil(points.length / 6));

  return (
    <div>
      <svg
        className="trend-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="访问趋势图"
      >
        {ticks.map((tick) => {
          const value = Math.round(max * tick);
          const lineY = padding.top + innerHeight - tick * innerHeight;
          return (
            <g key={tick}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={lineY}
                y2={lineY}
                stroke="#eef2f7"
                strokeWidth={1}
              />
              <text x={padding.left - 10} y={lineY + 4} textAnchor="end" fontSize={10.5} fill="#8497a9">
                {value >= 1000 ? `${Math.round(value / 1000)}k` : value}
              </text>
            </g>
          );
        })}

        {metrics.map((metric) => {
          const path = points
            .map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index)},${y(point[metric.key] as number)}`)
            .join(' ');
          return (
            <g key={metric.key}>
              <path d={path} fill="none" stroke={metric.color} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
              {points.map((point, index) =>
                index % labelStep === 0 || index === points.length - 1 ? (
                  <circle
                    key={`${metric.key}-${point.date}`}
                    cx={x(index)}
                    cy={y(point[metric.key] as number)}
                    r={2.6}
                    fill="#fff"
                    stroke={metric.color}
                    strokeWidth={1.6}
                  >
                    <title>{`${point.date} · ${metric.label}：${point[metric.key]}`}</title>
                  </circle>
                ) : null,
              )}
            </g>
          );
        })}

        {points.map((point, index) =>
          index % labelStep === 0 || index === points.length - 1 ? (
            <text
              key={point.date}
              x={x(index)}
              y={height - 12}
              textAnchor="middle"
              fontSize={10.5}
              fill="#8497a9"
            >
              {point.date.slice(5)}
            </text>
          ) : null,
        )}
      </svg>
      <div className="chart-legend">
        {metrics.map((metric) => (
          <span key={metric.key}>
            <i className="chart-dot" style={{ background: metric.color }} />
            {metric.label}
          </span>
        ))}
      </div>
    </div>
  );
}
