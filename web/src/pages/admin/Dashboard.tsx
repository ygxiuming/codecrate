import { useEffect, useState } from 'react';
import { Button, Col, List, Row, Skeleton, Table } from 'antd';
import {
  AppstoreOutlined,
  CloudServerOutlined,
  CodeOutlined,
  DatabaseOutlined,
  DownloadOutlined,
  EyeOutlined,
  ShopOutlined,
  UploadOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import type { Overview, TaskRow } from '../../api/types';
import { AdminCard, StatCard } from '../../components/StatCard';
import { formatBytes, formatDate, formatNumber } from '../../lib/format';
import { TaskKindTag, TaskStatusTag } from '../../lib/labels';

export function DashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api
      .get<Overview>('/api/admin/overview')
      .then((result) => {
        if (active) setData(result);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (loading || !data) {
    return (
      <div className="stack">
        <Skeleton active paragraph={{ rows: 3 }} />
        <Skeleton active paragraph={{ rows: 6 }} />
      </div>
    );
  }

  const queuedOrRunning = (data.tasks.queued ?? 0) + (data.tasks.running ?? 0);
  const failed = data.tasks.failed ?? 0;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="stat-grid">
        <StatCard
          label="VS Code 版本"
          value={formatNumber(data.vscodeVersions)}
          foot={`${formatNumber(data.vscodePackages)} 个平台安装包`}
          icon={<CodeOutlined />}
        />
        <StatCard
          label="离线插件"
          value={formatNumber(data.extensionCount)}
          foot={`${formatNumber(data.extensionVersions)} 个版本记录`}
          icon={<AppstoreOutlined />}
        />
        <StatCard
          label="Remote-SSH 版本"
          value={formatNumber(data.remoteVersions)}
          foot={`${formatNumber(data.remotePackages)} 个 server 包`}
          icon={<CloudServerOutlined />}
        />
        <StatCard
          label="存储占用"
          value={formatBytes(data.storage.artifacts.total.bytes)}
          foot={`磁盘剩余 ${formatBytes(data.storage.disk.freeBytes)} · 临时文件 ${formatBytes(data.storage.temp.bytes)}`}
          icon={<DatabaseOutlined />}
        />
      </div>

      <div className="stat-grid">
        <StatCard label="今日浏览量 PV" value={formatNumber(data.today.pv)} foot="页面访问事件" icon={<EyeOutlined />} />
        <StatCard label="今日访客 UV" value={formatNumber(data.today.uv)} foot="按匿名访客标识去重" icon={<UserOutlined />} />
        <StatCard label="今日下载量" value={formatNumber(data.today.downloads)} foot="以服务端实际传输为准" icon={<DownloadOutlined />} />
        <StatCard
          label="任务队列"
          value={`${queuedOrRunning} 排队/运行`}
          foot={failed > 0 ? `${failed} 个失败任务待处理` : '暂无失败任务'}
          icon={<CloudServerOutlined />}
        />
      </div>

      <div className="panel">
        <div className="row-between">
          <div>
            <strong style={{ fontSize: 15 }}>快捷操作</strong>
            <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
              采集动作需要服务器能够访问对应数据源。
            </div>
          </div>
          <div className="toolbar-inline">
            <Button type="primary" icon={<CodeOutlined />} onClick={() => navigate('/admin/vscode')}>
              缓存 VS Code
            </Button>
            <Button icon={<UploadOutlined />} onClick={() => navigate('/admin/extensions')}>
              上传插件
            </Button>
            <Button icon={<ShopOutlined />} onClick={() => navigate('/admin/marketplace')}>
              浏览市场
            </Button>
            <Button icon={<CloudServerOutlined />} onClick={() => navigate('/admin/remote')}>
              缓存 Server
            </Button>
            <Button icon={<DatabaseOutlined />} onClick={() => navigate('/admin/storage')}>
              存储管理
            </Button>
          </div>
        </div>
      </div>

      <Row gutter={[18, 18]}>
        <Col xs={24} xl={15}>
          <AdminCard
            title="最近任务"
            extra={<Link to="/admin/tasks">查看全部</Link>}
            bodyStyle={{ padding: 0 }}
          >
            <Table<TaskRow>
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={data.recentTasks}
              locale={{ emptyText: '暂无任务' }}
              columns={[
                { title: 'ID', dataIndex: 'id', width: 64 },
                {
                  title: '类型',
                  dataIndex: 'kind',
                  width: 150,
                  render: (kind: TaskRow['kind']) => <TaskKindTag kind={kind} />,
                },
                {
                  title: '目标',
                  dataIndex: 'target_key',
                  ellipsis: true,
                  render: (value: string) => (
                    <span className="mono" style={{ fontSize: 11.5 }}>
                      {value}
                    </span>
                  ),
                },
                {
                  title: '状态',
                  dataIndex: 'status',
                  width: 96,
                  render: (status: TaskRow['status']) => <TaskStatusTag status={status} />,
                },
                {
                  title: '时间',
                  dataIndex: 'created_at',
                  width: 140,
                  render: (value: string) => (
                    <span className="muted" style={{ fontSize: 12 }}>
                      {formatDate(value)}
                    </span>
                  ),
                },
              ]}
            />
          </AdminCard>
        </Col>
        <Col xs={24} xl={9}>
          <AdminCard title="最近审计" extra={<Link to="/admin/logs">日志</Link>} bodyStyle={{ padding: '8px 18px' }}>
            <List
              size="small"
              dataSource={data.recentAudit}
              locale={{ emptyText: '暂无记录' }}
              renderItem={(item) => (
                <List.Item style={{ paddingInline: 0 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 550 }}>{item.action}</div>
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                      {item.actor} · {item.target_type ?? '—'} {item.target_id ?? ''} · {item.ip ?? '—'}
                    </div>
                  </div>
                  <span className="muted" style={{ fontSize: 11.5 }}>
                    {formatDate(item.created_at, 'MM-DD HH:mm')}
                  </span>
                </List.Item>
              )}
            />
          </AdminCard>
        </Col>
      </Row>

      <AdminCard title="最近下载" extra={<Link to="/admin/analytics">访问分析</Link>} bodyStyle={{ padding: 0 }}>
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={data.recentDownloads}
          locale={{ emptyText: '暂无下载记录' }}
          columns={[
            { title: '时间', dataIndex: 'created_at', width: 160, render: (value: string) => formatDate(value) },
            { title: '资源', dataIndex: 'target', ellipsis: true },
            {
              title: '类型',
              dataIndex: 'resource_type',
              width: 130,
              render: (value: string | null) => value ?? '—',
            },
            { title: 'IP', dataIndex: 'ip', width: 160, render: (value: string | null) => value ?? '—' },
            {
              title: '字节数',
              dataIndex: 'bytes_sent',
              width: 110,
              render: (value: number | null) => formatBytes(value),
            },
          ]}
        />
      </AdminCard>
    </div>
  );
}
