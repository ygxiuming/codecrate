import { useCallback, useEffect, useState } from 'react';
import { Button, Input, Pagination, Select, Table, Tabs, Tag, Tooltip, message } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { api, qs } from '../../api/client';
import type { AccessEventRow, AuditRow } from '../../api/types';
import { formatBytes, formatDate, formatNumber, shortSha } from '../../lib/format';

const AUDIT_ACTIONS = [
  { value: 'auth.login_success', label: '登录成功' },
  { value: 'auth.login_failed', label: '登录失败' },
  { value: 'auth.logout', label: '退出登录' },
  { value: 'auth.password_changed', label: '修改密码' },
  { value: 'vscode.cache', label: '缓存 VS Code' },
  { value: 'remote.cache', label: '缓存 Remote-SSH' },
  { value: 'extension.upload', label: '上传插件' },
  { value: 'extension.delete', label: '删除插件' },
  { value: 'marketplace.cache', label: '市场缓存插件' },
  { value: 'task.retry', label: '重试任务' },
  { value: 'task.cancel', label: '取消任务' },
  { value: 'task.retry_failed', label: '批量重试' },
  { value: 'storage.verify', label: '完整性校验' },
  { value: 'storage.delete', label: '删除资源' },
  { value: 'storage.cleanup', label: '清理临时文件' },
  { value: 'settings.update', label: '修改设置' },
  { value: 'settings.test_source', label: '测试数据源' },
  { value: 'access.login_success', label: '访问码验证成功' },
  { value: 'access.login_failed', label: '访问码验证失败' },
];

export function LogsPage() {
  const [tab, setTab] = useState('audit');

  const [auditData, setAuditData] = useState<{ items: AuditRow[]; total: number } | null>(null);
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditPage, setAuditPage] = useState(1);
  const [auditQuery, setAuditQuery] = useState('');
  const [auditInput, setAuditInput] = useState('');
  const [auditAction, setAuditAction] = useState<string | undefined>();

  const [downloads, setDownloads] = useState<{ items: AccessEventRow[]; total: number } | null>(null);
  const [downloadLoading, setDownloadLoading] = useState(true);
  const [downloadPage, setDownloadPage] = useState(1);
  const [ip, setIp] = useState('');
  const [ipInput, setIpInput] = useState('');

  const loadAudit = useCallback(() => {
    setAuditLoading(true);
    api
      .get<{ items: AuditRow[]; total: number }>(
        `/api/admin/audit${qs({ q: auditQuery, action: auditAction, page: auditPage, pageSize: 30 })}`,
      )
      .then(setAuditData)
      .catch((error) => message.error((error as Error).message))
      .finally(() => setAuditLoading(false));
  }, [auditQuery, auditAction, auditPage]);

  const loadDownloads = useCallback(() => {
    setDownloadLoading(true);
    api
      .get<{ items: AccessEventRow[]; total: number }>(
        `/api/admin/access-events${qs({ type: 'download', ip, page: downloadPage, pageSize: 30 })}`,
      )
      .then(setDownloads)
      .catch((error) => message.error((error as Error).message))
      .finally(() => setDownloadLoading(false));
  }, [ip, downloadPage]);

  useEffect(() => {
    if (tab === 'audit') loadAudit();
  }, [tab, loadAudit]);

  useEffect(() => {
    if (tab === 'downloads') loadDownloads();
  }, [tab, loadDownloads]);

  return (
    <div className="stack">
      <div className="page-title">
        <h2>日志审计</h2>
        <p>敏感操作与下载行为留痕。请求级日志同时输出到容器 stdout，可接入集中日志系统。</p>
      </div>

      <div className="panel">
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: 'audit',
              label: '审计日志',
              children: (
                <div>
                  <div className="toolbar-inline" style={{ marginBottom: 14 }}>
                    <Input
                      allowClear
                      style={{ width: 260 }}
                      prefix={<SearchOutlined style={{ color: '#7c93a9' }} />}
                      placeholder="搜索操作者、动作或目标"
                      value={auditInput}
                      onChange={(event) => setAuditInput(event.target.value)}
                      onPressEnter={() => {
                        setAuditPage(1);
                        setAuditQuery(auditInput.trim());
                      }}
                    />
                    <Select
                      allowClear
                      style={{ width: 200 }}
                      placeholder="全部动作"
                      value={auditAction}
                      options={AUDIT_ACTIONS}
                      onChange={(value) => {
                        setAuditAction(value);
                        setAuditPage(1);
                      }}
                    />
                    <Button
                      onClick={() => {
                        setAuditPage(1);
                        setAuditQuery(auditInput.trim());
                      }}
                      icon={<SearchOutlined />}
                    >
                      查询
                    </Button>
                    <Button icon={<ReloadOutlined />} onClick={loadAudit}>
                      刷新
                    </Button>
                    <span style={{ marginLeft: 'auto' }} className="muted">
                      共 {formatNumber(auditData?.total ?? 0)} 条
                    </span>
                  </div>
                  <Table<AuditRow>
                    rowKey="id"
                    size="middle"
                    loading={auditLoading}
                    dataSource={auditData?.items ?? []}
                    pagination={false}
                    scroll={{ x: 1000 }}
                    expandable={{
                      expandedRowRender: (row) => (
                        <pre
                          className="mono"
                          style={{
                            margin: 0,
                            fontSize: 11.5,
                            background: '#f7f9fc',
                            padding: 12,
                            borderRadius: 8,
                            overflowX: 'auto',
                          }}
                        >
                          {JSON.stringify(row.detail ?? {}, null, 2)}
                        </pre>
                      ),
                    }}
                    columns={[
                      {
                        title: '时间',
                        dataIndex: 'created_at',
                        width: 170,
                        render: (value: string) => (
                          <span className="muted" style={{ fontSize: 12 }}>
                            {formatDate(value, 'YYYY-MM-DD HH:mm:ss')}
                          </span>
                        ),
                      },
                      { title: '操作者', dataIndex: 'actor', width: 130 },
                      {
                        title: '动作',
                        dataIndex: 'action',
                        width: 190,
                        render: (value: string) => (
                          <Tag style={{ borderRadius: 999 }}>{value}</Tag>
                        ),
                      },
                      {
                        title: '目标',
                        key: 'target',
                        ellipsis: true,
                        render: (_, row) =>
                          row.target_type ? (
                            <span style={{ fontSize: 12.5 }}>
                              {row.target_type} {row.target_id ?? ''}
                            </span>
                          ) : (
                            <span className="muted">—</span>
                          ),
                      },
                      { title: 'IP', dataIndex: 'ip', width: 160, render: (value: string | null) => value ?? '—' },
                      {
                        title: 'UA',
                        dataIndex: 'user_agent',
                        width: 70,
                        render: (value: string | null) =>
                          value ? (
                            <Tooltip title={value}>
                              <span className="muted" style={{ fontSize: 12 }}>
                                查看
                              </span>
                            </Tooltip>
                          ) : (
                            '—'
                          ),
                      },
                    ]}
                    locale={{ emptyText: '暂无审计记录' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                    <Pagination
                      current={auditPage}
                      pageSize={30}
                      total={auditData?.total ?? 0}
                      showTotal={(total) => `共 ${total} 条`}
                      onChange={(nextPage) => setAuditPage(nextPage)}
                    />
                  </div>
                </div>
              ),
            },
            {
              key: 'downloads',
              label: '下载日志',
              children: (
                <div>
                  <div className="toolbar-inline" style={{ marginBottom: 14 }}>
                    <Input
                      allowClear
                      style={{ width: 240 }}
                      prefix={<SearchOutlined style={{ color: '#7c93a9' }} />}
                      placeholder="按 IP 前缀筛选"
                      value={ipInput}
                      onChange={(event) => setIpInput(event.target.value)}
                      onPressEnter={() => {
                        setDownloadPage(1);
                        setIp(ipInput.trim());
                      }}
                    />
                    <Button
                      onClick={() => {
                        setDownloadPage(1);
                        setIp(ipInput.trim());
                      }}
                      icon={<SearchOutlined />}
                    >
                      查询
                    </Button>
                    <Button icon={<ReloadOutlined />} onClick={loadDownloads}>
                      刷新
                    </Button>
                    <span style={{ marginLeft: 'auto' }} className="muted">
                      共 {formatNumber(downloads?.total ?? 0)} 条
                    </span>
                  </div>
                  <Table<AccessEventRow>
                    rowKey="id"
                    size="middle"
                    loading={downloadLoading}
                    dataSource={downloads?.items ?? []}
                    pagination={false}
                    scroll={{ x: 1000 }}
                    columns={[
                      {
                        title: '时间',
                        dataIndex: 'created_at',
                        width: 170,
                        render: (value: string) => (
                          <span className="muted" style={{ fontSize: 12 }}>
                            {formatDate(value, 'YYYY-MM-DD HH:mm:ss')}
                          </span>
                        ),
                      },
                      { title: '文件', dataIndex: 'target', ellipsis: true },
                      {
                        title: '资源',
                        key: 'resource',
                        width: 170,
                        render: (_, row) =>
                          row.resource_type ? `${row.resource_type} #${row.resource_id}` : '—',
                      },
                      { title: 'IP', dataIndex: 'ip', width: 150, render: (value: string | null) => value ?? '—' },
                      {
                        title: '字节数',
                        dataIndex: 'bytes_sent',
                        width: 110,
                        render: (value: number | null) => formatBytes(value),
                      },
                      {
                        title: '状态',
                        dataIndex: 'status_code',
                        width: 80,
                        render: (value: number | null) =>
                          value === 200 || value === 206 ? (
                            <Tag color="green">{value}</Tag>
                          ) : (
                            <Tag>{value ?? '—'}</Tag>
                          ),
                      },
                      {
                        title: '耗时',
                        dataIndex: 'duration_ms',
                        width: 100,
                        render: (value: number | null) => (value ? `${value} ms` : '—'),
                      },
                      {
                        title: '访客',
                        dataIndex: 'visitor_id',
                        width: 110,
                        render: (value: string | null) =>
                          value ? (
                            <Tooltip title={value}>
                              <span className="mono" style={{ fontSize: 11 }}>
                                {shortSha(value, 8)}
                              </span>
                            </Tooltip>
                          ) : (
                            '—'
                          ),
                      },
                    ]}
                    locale={{ emptyText: '暂无下载记录' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                    <Pagination
                      current={downloadPage}
                      pageSize={30}
                      total={downloads?.total ?? 0}
                      showTotal={(total) => `共 ${total} 条`}
                      onChange={(nextPage) => setDownloadPage(nextPage)}
                    />
                  </div>
                </div>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
