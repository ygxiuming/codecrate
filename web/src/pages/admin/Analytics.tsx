import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  DatePicker,
  Input,
  List,
  Pagination,
  Segmented,
  Select,
  Table,
  Tag,
  Tooltip,
  message,
} from 'antd';
import { DownloadOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { api, qs } from '../../api/client';
import type {
  AccessEventRow,
  AnalyticsOverview,
  TimeseriesPoint,
  TopContent,
} from '../../api/types';
import { AdminCard, StatCard } from '../../components/StatCard';
import { TrendChart } from '../../components/TrendChart';
import { downloadText, formatBytes, formatDate, formatNumber, growth, shortSha, toCsv } from '../../lib/format';

const EVENT_LABEL: Record<string, string> = {
  page_view: '浏览',
  click: '点击',
  download: '下载',
  search: '搜索',
};

const EVENT_COLOR: Record<string, string> = {
  page_view: 'blue',
  click: 'purple',
  download: 'gold',
  search: 'cyan',
};

function Growth({ current, previous }: { current: number; previous: number }) {
  const value = growth(current, previous);
  if (value === null) return <span>较上一周期 —</span>;
  return (
    <span style={{ color: value >= 0 ? '#1f9d55' : '#d92d20' }}>
      {value >= 0 ? '+' : ''}
      {value}% 较上一周期
    </span>
  );
}

export function AnalyticsPage() {
  const [days, setDays] = useState(7);
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [points, setPoints] = useState<TimeseriesPoint[]>([]);
  const [top, setTop] = useState<TopContent | null>(null);
  const [events, setEvents] = useState<AccessEventRow[]>([]);
  const [eventsTotal, setEventsTotal] = useState(0);
  const [eventType, setEventType] = useState<string | undefined>();
  const [resourceType, setResourceType] = useState<string | undefined>();
  const [ipInput, setIpInput] = useState('');
  const [ip, setIp] = useState('');
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [page, setPage] = useState(1);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const loadSummary = useCallback(() => {
    void Promise.all([
      api.get<AnalyticsOverview>(`/api/admin/analytics/overview?days=${days}`),
      api.get<{ points: TimeseriesPoint[] }>(`/api/admin/analytics/timeseries?days=${days}`),
      api.get<TopContent>(`/api/admin/analytics/top?days=${days}&limit=8`),
    ])
      .then(([overviewData, series, topData]) => {
        setOverview(overviewData);
        setPoints(series.points);
        setTop(topData);
      })
      .catch((error) => message.error((error as Error).message));
  }, [days]);

  const loadEvents = useCallback(() => {
    setEventsLoading(true);
    api
      .get<{ items: AccessEventRow[]; total: number }>(
        `/api/admin/access-events${qs({
          type: eventType,
          resourceType,
          ip,
          from: range ? range[0].startOf('day').toISOString() : undefined,
          to: range ? range[1].endOf('day').toISOString() : undefined,
          page,
          pageSize: 20,
        })}`,
      )
      .then((result) => {
        setEvents(result.items);
        setEventsTotal(result.total);
      })
      .catch((error) => message.error((error as Error).message))
      .finally(() => setEventsLoading(false));
  }, [eventType, resourceType, ip, range, page]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const exportCsv = async (): Promise<void> => {
    setExporting(true);
    try {
      const result = await api.get<{ items: AccessEventRow[]; count: number }>(
        `/api/admin/access-events/export${qs({
          type: eventType,
          resourceType,
          ip,
          from: range ? range[0].startOf('day').toISOString() : undefined,
          to: range ? range[1].endOf('day').toISOString() : undefined,
        })}`,
      );
      const headers = [
        'id',
        '时间',
        '事件类型',
        '路径',
        '目标',
        '资源类型',
        '资源ID',
        'IP',
        'IP协议',
        '访客ID',
        '状态码',
        '字节数',
        '耗时ms',
        'User-Agent',
        'Referer',
        'Metadata',
      ];
      const rows = result.items.map((item) => [
        item.id,
        item.created_at,
        item.event_type,
        item.path,
        item.target,
        item.resource_type,
        item.resource_id,
        item.ip,
        item.ip_family,
        item.visitor_id,
        item.status_code,
        item.bytes_sent,
        item.duration_ms,
        item.user_agent,
        item.referer,
        item.metadata ? JSON.stringify(item.metadata) : '',
      ]);
      downloadText(`access-events-${dayjs().format('YYYYMMDD-HHmmss')}.csv`, toCsv(headers, rows), 'text/csv;charset=utf-8');
      message.success(`已导出 ${result.count} 条事件`);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setExporting(false);
    }
  };

  const current = overview?.current;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="row-between">
        <div className="page-title" style={{ marginBottom: 0 }}>
          <h2>访问分析</h2>
          <p>记录普通用户的页面浏览、搜索、点击与真实下载，用于了解内网资源使用情况。</p>
        </div>
        <Segmented
          value={days}
          options={[
            { value: 1, label: '今日' },
            { value: 7, label: '7 天' },
            { value: 30, label: '30 天' },
            { value: 90, label: '90 天' },
          ]}
          onChange={(value) => {
            setDays(Number(value));
            setPage(1);
          }}
        />
      </div>

      {overview && !overview.enabled ? (
        <Alert
          type="warning"
          showIcon
          message="访问日志已关闭"
          description="当前不会记录普通用户的浏览与点击。可在「系统设置 → 访问与日志」中重新开启。"
          style={{ borderRadius: 12 }}
        />
      ) : null}

      <div className="stat-grid">
        <StatCard
          label="浏览量 PV"
          value={formatNumber(current?.pv)}
          foot={<Growth current={current?.pv ?? 0} previous={overview?.previous.pv ?? 0} />}
        />
        <StatCard
          label="独立访客 UV"
          value={formatNumber(current?.uv)}
          foot={<Growth current={current?.uv ?? 0} previous={overview?.previous.uv ?? 0} />}
        />
        <StatCard
          label="下载量"
          value={formatNumber(current?.downloads)}
          foot={<Growth current={current?.downloads ?? 0} previous={overview?.previous.downloads ?? 0} />}
        />
        <StatCard
          label="点击 / 搜索"
          value={`${formatNumber(current?.clicks)} / ${formatNumber(current?.searches)}`}
          foot="按钮点击与站内搜索提交"
        />
      </div>

      <AdminCard title="访问趋势" extra={<span className="muted" style={{ fontSize: 12 }}>按 UTC 日期聚合</span>}>
        <TrendChart points={points} />
      </AdminCard>

      <div className="top-grid">
        <AdminCard title="热门页面" bodyStyle={{ padding: '4px 18px' }}>
          <List
            size="small"
            dataSource={top?.pages ?? []}
            locale={{ emptyText: '暂无浏览数据' }}
            renderItem={(item, index) => (
              <List.Item style={{ paddingInline: 0 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span className="muted" style={{ marginRight: 8 }}>{index + 1}</span>
                  {item.path}
                </span>
                <span className="muted">{formatNumber(item.count)}</span>
              </List.Item>
            )}
          />
        </AdminCard>
        <AdminCard title="热门下载" bodyStyle={{ padding: '4px 18px' }}>
          <List
            size="small"
            dataSource={top?.downloads ?? []}
            locale={{ emptyText: '暂无下载数据' }}
            renderItem={(item, index) => (
              <List.Item style={{ paddingInline: 0 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span className="muted" style={{ marginRight: 8 }}>{index + 1}</span>
                  {item.target ?? `${item.resource_type ?? ''} #${item.resource_id ?? ''}`}
                </span>
                <span className="muted">{formatNumber(item.count)}</span>
              </List.Item>
            )}
          />
        </AdminCard>
        <AdminCard title="热门搜索" bodyStyle={{ padding: '4px 18px' }}>
          <List
            size="small"
            dataSource={top?.searches ?? []}
            locale={{ emptyText: '暂无搜索数据' }}
            renderItem={(item, index) => (
              <List.Item style={{ paddingInline: 0 }}>
                <span>
                  <span className="muted" style={{ marginRight: 8 }}>{index + 1}</span>
                  {item.target}
                </span>
                <span className="muted">{formatNumber(item.count)}</span>
              </List.Item>
            )}
          />
        </AdminCard>
      </div>

      <div className="panel">
        <div className="toolbar-inline" style={{ marginBottom: 14 }}>
          <strong style={{ fontSize: 15, marginRight: 6 }}>事件明细</strong>
          <Select
            allowClear
            style={{ width: 130 }}
            placeholder="全部类型"
            value={eventType}
            onChange={(value) => {
              setEventType(value);
              setPage(1);
            }}
            options={[
              { value: 'page_view', label: '浏览' },
              { value: 'click', label: '点击' },
              { value: 'download', label: '下载' },
              { value: 'search', label: '搜索' },
            ]}
          />
          <Select
            allowClear
            style={{ width: 160 }}
            placeholder="全部资源类型"
            value={resourceType}
            onChange={(value) => {
              setResourceType(value);
              setPage(1);
            }}
            options={[
              { value: 'vscode', label: 'VS Code 安装包' },
              { value: 'extension', label: '插件' },
              { value: 'remote-server', label: 'Remote-SSH Server' },
            ]}
          />
          <Input
            allowClear
            style={{ width: 200 }}
            prefix={<SearchOutlined style={{ color: '#7c93a9' }} />}
            placeholder="按 IP 前缀筛选"
            value={ipInput}
            onChange={(event) => setIpInput(event.target.value)}
            onPressEnter={() => {
              setIp(ipInput.trim());
              setPage(1);
            }}
          />
          <DatePicker.RangePicker
            value={range}
            onChange={(value) => {
              setRange(value as [Dayjs, Dayjs] | null);
              setPage(1);
            }}
          />
          <Button
            onClick={() => {
              setIp(ipInput.trim());
              setPage(1);
            }}
          >
            筛选
          </Button>
          <Button
            style={{ marginLeft: 'auto' }}
            icon={<DownloadOutlined />}
            loading={exporting}
            onClick={() => void exportCsv()}
          >
            导出 CSV
          </Button>
        </div>

        <Table<AccessEventRow>
          rowKey="id"
          size="middle"
          loading={eventsLoading}
          dataSource={events}
          pagination={false}
          scroll={{ x: 1050 }}
          columns={[
            {
              title: '时间',
              dataIndex: 'created_at',
              width: 160,
              render: (value: string) => (
                <span className="muted" style={{ fontSize: 12 }}>{formatDate(value, 'YYYY-MM-DD HH:mm:ss')}</span>
              ),
            },
            {
              title: '类型',
              dataIndex: 'event_type',
              width: 90,
              render: (value: string) => (
                <Tag color={EVENT_COLOR[value] ?? 'default'} style={{ borderRadius: 999 }}>
                  {EVENT_LABEL[value] ?? value}
                </Tag>
              ),
            },
            {
              title: '页面 / 目标',
              key: 'target',
              ellipsis: true,
              render: (_, row) => <span style={{ fontSize: 12.5 }}>{row.path ?? row.target ?? '—'}</span>,
            },
            {
              title: '资源',
              key: 'resource',
              width: 190,
              render: (_, row) =>
                row.resource_type ? (
                  <span className="muted" style={{ fontSize: 12 }}>
                    {row.resource_type} #{row.resource_id}
                  </span>
                ) : (
                  <span className="muted">—</span>
                ),
            },
            { title: 'IP', dataIndex: 'ip', width: 150, render: (value: string | null) => value ?? '—' },
            {
              title: '访客',
              dataIndex: 'visitor_id',
              width: 120,
              render: (value: string | null) =>
                value ? (
                  <Tooltip title={value}>
                    <span className="mono" style={{ fontSize: 11 }}>{shortSha(value, 8)}</span>
                  </Tooltip>
                ) : (
                  '—'
                ),
            },
            {
              title: '传输',
              key: 'bytes',
              width: 120,
              render: (_, row) =>
                row.bytes_sent ? (
                  <span style={{ fontSize: 12 }}>
                    {formatBytes(row.bytes_sent)}
                    <span className="muted"> · {row.status_code ?? '—'}</span>
                  </span>
                ) : (
                  <span className="muted">—</span>
                ),
            },
            {
              title: 'UA',
              dataIndex: 'user_agent',
              width: 70,
              render: (value: string | null) =>
                value ? (
                  <Tooltip title={value}>
                    <span className="muted" style={{ fontSize: 12 }}>查看</span>
                  </Tooltip>
                ) : (
                  '—'
                ),
            },
          ]}
          locale={{ emptyText: '暂无事件' }}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <Pagination
            current={page}
            pageSize={20}
            total={eventsTotal}
            showTotal={(total) => `共 ${total} 条事件`}
            onChange={(nextPage) => setPage(nextPage)}
          />
        </div>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ borderRadius: 12 }}
        message={`访问日志保留 ${overview?.retentionDays ?? 90} 天，包含完整 IP 与匿名访客标识`}
        description="访客标识为服务端签名的 HttpOnly Cookie，仅用于 UV 与去重，不做跨站跟踪。可在「系统设置 → 访问与日志」调整保留期或关闭采集。"
      />
    </div>
  );
}
