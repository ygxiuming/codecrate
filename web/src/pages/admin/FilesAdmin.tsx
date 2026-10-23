import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Checkbox,
  Input,
  InputNumber,
  Modal,
  Pagination,
  Popconfirm,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  message,
} from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { api, qs } from '../../api/client';
import type { AdminPublicFileResponse, AdminShare } from '../../api/types';
import { Sha256 } from '../../components/Sha256';
import { formatBytes, formatDate, formatNumber, isPermanentExpiry } from '../../lib/format';

function expiryTag(expiresAt: string, revoked?: boolean): JSX.Element {
  if (revoked) return <Tag color="red" style={{ borderRadius: 999 }}>已撤销</Tag>;
  if (isPermanentExpiry(expiresAt)) return <Tag color="blue" style={{ borderRadius: 999 }}>永久有效</Tag>;
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return <Tag color="orange" style={{ borderRadius: 999 }}>待清理</Tag>;
  const hours = Math.floor(diff / 3600_000);
  return (
    <Tag color={hours < 24 ? 'gold' : 'green'} style={{ borderRadius: 999 }}>
      {hours < 24 ? `${hours} 小时后到期` : `${Math.floor(hours / 24)} 天后到期`}
    </Tag>
  );
}

interface ExtendTarget {
  zone: 'public' | 'shares';
  id: number;
  filename: string;
}

/** 调整有效期：支持 分钟/小时/天 三种粒度，或设为永久有效。 */
function ExtendExpiryModal({
  target,
  onClose,
  onDone,
}: {
  target: ExtendTarget | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [value, setValue] = useState(7);
  const [unit, setUnit] = useState<'minutes' | 'hours' | 'days'>('days');
  const [permanent, setPermanent] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (target) {
      setValue(7);
      setUnit('days');
      setPermanent(false);
    }
  }, [target]);

  const submit = async (): Promise<void> => {
    if (!target) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = permanent
        ? { permanent: true }
        : { extend_value: value, extend_unit: unit };
      await api.put(`/api/admin/files/${target.zone}/${target.id}`, body);
      message.success(permanent ? '已设为永久有效' : '有效期已调整');
      onDone();
      onClose();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={Boolean(target)}
      title={target ? `调整有效期：${target.filename}` : '调整有效期'}
      okText="确认"
      cancelText="取消"
      confirmLoading={saving}
      onOk={() => void submit()}
      onCancel={onClose}
    >
      <div className="stack" style={{ gap: 12, paddingTop: 8 }}>
        <Checkbox
          checked={permanent}
          onChange={(event) => setPermanent(event.target.checked)}
        >
          设为永久有效（不再自动删除，可随时改回）
        </Checkbox>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <InputNumber
            min={1}
            max={5_256_000}
            value={value}
            onChange={(v) => setValue(Number(v) || 1)}
            disabled={permanent}
            style={{ width: 150 }}
          />
          <Select
            value={unit}
            onChange={(next) => setUnit(next)}
            disabled={permanent}
            style={{ width: 110 }}
            options={[
              { value: 'minutes', label: '分钟' },
              { value: 'hours', label: '小时' },
              { value: 'days', label: '天' },
            ]}
          />
          <span className="muted" style={{ fontSize: 12.5 }}>从现在起算</span>
        </div>
      </div>
    </Modal>
  );
}

function PublicFilesTab() {
  const [data, setData] = useState<AdminPublicFileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [q, setQ] = useState('');
  const [includeExpired, setIncludeExpired] = useState(true);
  const [page, setPage] = useState(1);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get<AdminPublicFileResponse>(
        `/api/admin/files/public${qs({ page, pageSize: 20, q, include_expired: includeExpired ? '1' : undefined })}`,
      )
      .then(setData)
      .catch((error) => message.error((error as Error).message))
      .finally(() => setLoading(false));
  }, [page, q, includeExpired]);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (id: number): Promise<void> => {
    try {
      await api.del(`/api/admin/files/public/${id}`);
      message.success('已删除');
      load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const [extendTarget, setExtendTarget] = useState<ExtendTarget | null>(null);

  return (
    <div className="stack">
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 4 }}>
        <Statistic title="公共区占用" value={formatBytes(data?.usage.publicBytes ?? 0)} />
        <Statistic title="私人共享占用" value={formatBytes(data?.usage.shareBytes ?? 0)} />
        <Statistic title="合计" value={formatBytes(data?.usage.totalBytes ?? 0)} />
      </div>
      <div className="toolbar-inline" style={{ marginBottom: 12 }}>
        <Input
          allowClear
          style={{ width: 260 }}
          prefix={<SearchOutlined style={{ color: '#7c93a9' }} />}
          placeholder="搜索文件名或备注"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onPressEnter={() => {
            setPage(1);
            setQ(keyword.trim());
          }}
        />
        <Button
          onClick={() => {
            setPage(1);
            setQ(keyword.trim());
          }}
        >
          搜索
        </Button>
        <Button
          type={includeExpired ? 'primary' : 'default'}
          onClick={() => {
            setPage(1);
            setIncludeExpired((value) => !value);
          }}
        >
          {includeExpired ? '含已到期' : '仅有效'}
        </Button>
        <Button icon={<ReloadOutlined />} onClick={load}>
          刷新
        </Button>
        <span className="muted" style={{ marginLeft: 'auto' }}>
          共 {formatNumber(data?.total ?? 0)} 条
        </span>
      </div>

      <Table
        rowKey="id"
        size="middle"
        loading={loading}
        dataSource={data?.items ?? []}
        pagination={false}
        expandable={{
          expandedRowRender: (row) => (
            <Space wrap size={16} style={{ fontSize: 12.5 }}>
              <span>
                <span className="muted">SHA256：</span>
                <Sha256 value={row.sha256} />
              </span>
              <span>
                <span className="muted">访客标识：</span>
                <code style={{ fontSize: 12 }}>{row.visitorId || '—'}</code>
              </span>
            </Space>
          ),
        }}
        columns={[
          {
            title: '文件',
            dataIndex: 'filename',
            render: (value: string, row) => (
              <div>
                <div style={{ fontWeight: 600, wordBreak: 'break-all' }}>{value}</div>
                {row.note ? <div className="muted" style={{ fontSize: 11.5 }}>备注：{row.note}</div> : null}
              </div>
            ),
          },
          {
            title: '大小',
            dataIndex: 'sizeBytes',
            width: 95,
            render: (value: number) => formatBytes(value),
          },
          {
            title: '上传者 IP',
            dataIndex: 'uploaderIp',
            width: 130,
            render: (value: string) => <span className="mono" style={{ fontSize: 12 }}>{value || '—'}</span>,
          },
          {
            title: '下载量',
            dataIndex: 'downloadCount',
            width: 80,
            render: (value: number) => formatNumber(value),
          },
          {
            title: '有效期',
            key: 'expiry',
            width: 160,
            render: (_, row) => (
              <div>
                {expiryTag(row.expiresAt)}
                <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                  {isPermanentExpiry(row.expiresAt) ? '不自动删除' : formatDate(row.expiresAt)}
                </div>
              </div>
            ),
          },
          {
            title: '操作',
            key: 'actions',
            width: 140,
            render: (_, row) => (
              <Space>
                <Button size="small" type="link" onClick={() => setExtendTarget({ zone: 'public', id: row.id, filename: row.filename })}>
                  延期
                </Button>
                <Popconfirm
                  title="删除该文件？"
                  description="会同时删除磁盘文件，且不可恢复。"
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => void remove(row.id)}
                >
                  <Button size="small" danger type="link">
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
        locale={{ emptyText: '公共区暂无文件' }}
      />
      <ExtendExpiryModal target={extendTarget} onClose={() => setExtendTarget(null)} onDone={load} />
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Pagination
          current={data?.page ?? 1}
          pageSize={data?.pageSize ?? 20}
          total={data?.total ?? 0}
          showTotal={(total) => `共 ${total} 条`}
          onChange={setPage}
        />
      </div>
    </div>
  );
}

function SharesTab() {
  const [data, setData] = useState<{ items: AdminShare[]; total: number; page: number; pageSize: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get<{ items: AdminShare[]; total: number; page: number; pageSize: number }>(
        `/api/admin/files/shares${qs({ page, pageSize: 20, q })}`,
      )
      .then(setData)
      .catch((error) => message.error((error as Error).message))
      .finally(() => setLoading(false));
  }, [page, q]);

  useEffect(() => {
    load();
  }, [load]);

  const revoke = async (row: AdminShare): Promise<void> => {
    try {
      await api.put(`/api/admin/files/shares/${row.id}`, { revoked: !row.revoked });
      message.success(row.revoked ? '已恢复' : '已撤销，取件码立即失效');
      load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const [extendTarget, setExtendTarget] = useState<ExtendTarget | null>(null);

  const remove = async (id: number): Promise<void> => {
    try {
      await api.del(`/api/admin/files/shares/${id}`);
      message.success('已删除');
      load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  return (
    <div className="stack">
      <div className="toolbar-inline" style={{ marginBottom: 12 }}>
        <Input
          allowClear
          style={{ width: 260 }}
          prefix={<SearchOutlined style={{ color: '#7c93a9' }} />}
          placeholder="搜索文件名或备注"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onPressEnter={() => {
            setPage(1);
            setQ(keyword.trim());
          }}
        />
        <Button
          onClick={() => {
            setPage(1);
            setQ(keyword.trim());
          }}
        >
          搜索
        </Button>
        <Button icon={<ReloadOutlined />} onClick={load}>
          刷新
        </Button>
        <span className="muted" style={{ marginLeft: 'auto' }}>
          共 {formatNumber(data?.total ?? 0)} 条
        </span>
      </div>

      <Table
        rowKey="id"
        size="middle"
        loading={loading}
        dataSource={data?.items ?? []}
        pagination={false}
        expandable={{
          expandedRowRender: (row) => (
            <Space wrap size={16} style={{ fontSize: 12.5 }}>
              <span>
                <span className="muted">SHA256：</span>
                <Sha256 value={row.sha256} />
              </span>
              <span>
                <span className="muted">访客标识：</span>
                <code style={{ fontSize: 12 }}>{row.visitorId || '—'}</code>
              </span>
              <span>
                <span className="muted">创建时间：</span>
                {formatDate(row.createdAt)}
              </span>
            </Space>
          ),
        }}
        columns={[
          {
            title: '文件',
            dataIndex: 'filename',
            render: (value: string, row) => (
              <div>
                <div style={{ fontWeight: 600, wordBreak: 'break-all' }}>{value}</div>
                {row.note ? <div className="muted" style={{ fontSize: 11.5 }}>备注：{row.note}</div> : null}
              </div>
            ),
          },
          {
            title: '大小',
            dataIndex: 'sizeBytes',
            width: 95,
            render: (value: number) => formatBytes(value),
          },
          {
            title: '上传者 IP',
            dataIndex: 'uploaderIp',
            width: 130,
            render: (value: string) => <span className="mono" style={{ fontSize: 12 }}>{value || '—'}</span>,
          },
          {
            title: '下载',
            key: 'downloads',
            width: 90,
            render: (_, row) =>
              row.maxDownloads ? `${row.downloadCount}/${row.maxDownloads}` : formatNumber(row.downloadCount),
          },
          {
            title: '有效期',
            key: 'expiry',
            width: 160,
            render: (_, row) => (
              <div>
                {expiryTag(row.expiresAt, row.revoked)}
                <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                  {isPermanentExpiry(row.expiresAt) ? '不自动删除' : formatDate(row.expiresAt)}
                </div>
              </div>
            ),
          },
          {
            title: '操作',
            key: 'actions',
            width: 170,
            render: (_, row) => (
              <Space>
                <Button size="small" type="link" onClick={() => setExtendTarget({ zone: 'shares', id: row.id, filename: row.filename })}>
                  延期
                </Button>
                <Popconfirm
                  title={row.revoked ? '恢复该取件？' : '撤销该取件？'}
                  description={row.revoked ? '恢复后取件码重新可用。' : '撤销后取件码立即失效。'}
                  okText={row.revoked ? '恢复' : '撤销'}
                  cancelText="取消"
                  onConfirm={() => void revoke(row)}
                >
                  <Button size="small" type="link">
                    {row.revoked ? '恢复' : '撤销'}
                  </Button>
                </Popconfirm>
                <Popconfirm
                  title="删除该取件？"
                  description="会同时删除磁盘文件，且不可恢复。"
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => void remove(row.id)}
                >
                  <Button size="small" danger type="link">
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
        locale={{ emptyText: '暂无私人取件' }}
      />
      <ExtendExpiryModal target={extendTarget} onClose={() => setExtendTarget(null)} onDone={load} />
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Pagination
          current={data?.page ?? 1}
          pageSize={data?.pageSize ?? 20}
          total={data?.total ?? 0}
          showTotal={(total) => `共 ${total} 条`}
          onChange={setPage}
        />
      </div>
    </div>
  );
}

export function FilesAdminPage() {
  return (
    <div className="stack">
      <div className="page-title">
        <h2>文件区管理</h2>
        <p>公共区与私人取件的完整管理权：查看上传者 IP、延期、撤销与删除。到期文件由系统自动清理。</p>
      </div>
      <div className="panel">
        <Tabs
          items={[
            { key: 'public', label: '公共区文件', children: <PublicFilesTab /> },
            { key: 'shares', label: '私人取件', children: <SharesTab /> },
          ]}
        />
      </div>
    </div>
  );
}
