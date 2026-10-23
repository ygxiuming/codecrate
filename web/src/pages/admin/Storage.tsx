import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Input,
  Pagination,
  Popconfirm,
  Segmented,
  Table,
  Tag,
  Tooltip,
  message,
} from 'antd';
import {
  DatabaseOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { api, qs } from '../../api/client';
import type { StorageArtifact } from '../../api/types';
import { DownloadButton } from '../../components/DownloadButton';
import { Sha256 } from '../../components/Sha256';
import { formatBytes, formatDate, formatNumber } from '../../lib/format';

type ArtifactType = 'vscode' | 'extension' | 'remote-server' | 'software';

interface Usage {
  artifacts: {
    vscode: { count: number; bytes: number };
    extensions: { count: number; bytes: number };
    remoteServers: { count: number; bytes: number };
    total: { count: number; bytes: number };
  };
  disk: { totalBytes: number; freeBytes: number; usedBytes: number };
  temp: { count: number; bytes: number };
}

interface TypeCounts {
  vscode: number;
  extensions: number;
  remoteServers: number;
}

interface ScanResult {
  scannedFiles: number;
  added: TypeCounts;
  updated: TypeCounts;
  removed: TypeCounts;
  skipped: number;
  errors: string[];
  durationMs: number;
}

function totalCounts(counts: TypeCounts): number {
  return counts.vscode + counts.extensions + counts.remoteServers;
}

export function StoragePage() {
  const [type, setType] = useState<ArtifactType>('vscode');
  const [usage, setUsage] = useState<Usage | null>(null);
  const [data, setData] = useState<{ items: StorageArtifact[]; total: number; page: number; pageSize: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [verifying, setVerifying] = useState<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);

  const loadUsage = useCallback(() => {
    void api
      .get<Usage>('/api/admin/storage')
      .then(setUsage)
      .catch((error) => message.error((error as Error).message));
  }, []);

  const loadArtifacts = useCallback(() => {
    setLoading(true);
    api
      .get<{ items: StorageArtifact[]; total: number; page: number; pageSize: number }>(
        `/api/admin/storage/artifacts${qs({ type, page, pageSize: 20, q })}`,
      )
      .then(setData)
      .catch((error) => message.error((error as Error).message))
      .finally(() => setLoading(false));
  }, [type, page, q]);

  useEffect(() => {
    loadUsage();
  }, [loadUsage]);

  useEffect(() => {
    loadArtifacts();
  }, [loadArtifacts]);

  const verify = async (row: StorageArtifact): Promise<void> => {
    setVerifying(row.id);
    try {
      const result = await api.post<{ ok: boolean; actual: string }>('/api/admin/storage/verify', {
        type: row.type,
        id: row.id,
      });
      if (result.ok) {
        message.success('SHA256 校验通过');
        loadArtifacts();
      } else {
        message.error('SHA256 不一致，文件可能损坏');
      }
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setVerifying(null);
    }
  };

  const remove = async (row: StorageArtifact): Promise<void> => {
    try {
      await api.del(`/api/admin/storage/${row.type}/${row.id}`);
      message.success('资源已删除');
      loadArtifacts();
      loadUsage();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const cleanup = async (): Promise<void> => {
    try {
      const result = await api.post<{ removed: number; bytes: number }>('/api/admin/storage/cleanup');
      message.success(`已清理 ${result.removed} 个临时文件，释放 ${formatBytes(result.bytes)}`);
      loadUsage();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const scan = async (): Promise<void> => {
    setScanning(true);
    try {
      const result = await api.post<ScanResult>('/api/admin/storage/scan');
      setScanResult(result);
      message.success(
        `扫描完成：新增 ${totalCounts(result.added)}，更新 ${totalCounts(
          result.updated,
        )}，移除 ${totalCounts(result.removed)}`,
      );
      loadArtifacts();
      loadUsage();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="stack">
      <div className="page-title">
        <h2>存储管理</h2>
        <p>
          查看资源占用、执行 SHA256 完整性校验、删除资源或清理临时文件。手动向缓存目录复制或删除文件后，
          点击「扫描缓存目录」同步索引，无需重启服务。
        </p>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">全部离线资源</div>
          <div className="stat-value">{formatBytes(usage?.artifacts.total.bytes)}</div>
          <div className="stat-foot">{formatNumber(usage?.artifacts.total.count)} 个文件</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">VS Code 安装包</div>
          <div className="stat-value">{formatBytes(usage?.artifacts.vscode.bytes)}</div>
          <div className="stat-foot">{formatNumber(usage?.artifacts.vscode.count)} 个文件</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">插件 .vsix</div>
          <div className="stat-value">{formatBytes(usage?.artifacts.extensions.bytes)}</div>
          <div className="stat-foot">{formatNumber(usage?.artifacts.extensions.count)} 个文件</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">磁盘剩余</div>
          <div className="stat-value">{formatBytes(usage?.disk.freeBytes)}</div>
          <div className="stat-foot">
            临时文件 {formatBytes(usage?.temp.bytes)} · {formatNumber(usage?.temp.count)} 个
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="toolbar-inline" style={{ marginBottom: 14 }}>
          <Segmented
            value={type}
            options={[
              { value: 'vscode', label: 'VS Code 安装包' },
              { value: 'extension', label: '插件' },
              { value: 'remote-server', label: 'Remote-SSH Server' },
              { value: 'software', label: '软件包' },
            ]}
            onChange={(value) => {
              setType(value as ArtifactType);
              setPage(1);
            }}
          />
          <Input
            allowClear
            style={{ width: 240 }}
            prefix={<SearchOutlined style={{ color: '#7c93a9' }} />}
            placeholder="搜索文件名 / 版本 / 插件 ID"
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
            icon={<ReloadOutlined />}
            onClick={() => {
              loadArtifacts();
              loadUsage();
            }}
          >
            刷新
          </Button>
          <Button
            type="primary"
            ghost
            icon={<SyncOutlined />}
            loading={scanning}
            onClick={() => void scan()}
          >
            扫描缓存目录
          </Button>
          <Popconfirm
            title="清理临时文件？"
            description="将删除 24 小时前的上传残留与 .part 分片，不影响已完成资源。"
            okText="清理"
            cancelText="取消"
            onConfirm={() => void cleanup()}
          >
            <Button>清理临时文件</Button>
          </Popconfirm>
          <span style={{ marginLeft: 'auto' }} className="muted">
            共 {formatNumber(data?.total ?? 0)} 个资源
          </span>
        </div>

        {scanResult ? (
          <Alert
            type={scanResult.errors.length > 0 ? 'warning' : 'success'}
            showIcon
            closable
            onClose={() => setScanResult(null)}
            style={{ marginBottom: 14, borderRadius: 10 }}
            message={`扫描完成 · 新增 ${totalCounts(scanResult.added)} · 更新 ${totalCounts(
              scanResult.updated,
            )} · 移除 ${totalCounts(scanResult.removed)} · 跳过 ${scanResult.skipped}`}
            description={
              <div style={{ fontSize: 12.5, lineHeight: 1.8 }}>
                <div>
                  共扫描 {formatNumber(scanResult.scannedFiles)} 个文件，耗时{' '}
                  {formatNumber(scanResult.durationMs)} ms。新增：VS Code{' '}
                  {scanResult.added.vscode}、插件 {scanResult.added.extensions}、Remote-SSH{' '}
                  {scanResult.added.remoteServers}。
                </div>
                {scanResult.errors.length > 0 ? (
                  <div style={{ color: '#8a5a00', whiteSpace: 'pre-wrap' }}>
                    {scanResult.errors.slice(0, 8).join('\n')}
                    {scanResult.errors.length > 8 ? `\n…另有 ${scanResult.errors.length - 8} 条` : ''}
                  </div>
                ) : null}
              </div>
            }
          />
        ) : null}

        <Table<StorageArtifact>
          rowKey="id"
          size="middle"
          loading={loading}
          dataSource={data?.items ?? []}
          pagination={false}
          scroll={{ x: 1150 }}
          columns={[
            {
              title: '文件',
              dataIndex: 'filename',
              ellipsis: true,
              render: (value: string, row) => (
                <div>
                  <div style={{ fontWeight: 550 }}>{value}</div>
                  {row.extension_id ? (
                    <div className="muted mono" style={{ fontSize: 11.5 }}>
                      {row.extension_id}
                    </div>
                  ) : null}
                </div>
              ),
            },
            {
              title: '版本 / 平台',
              key: 'version',
              width: 170,
              render: (_, row) => (
                <div style={{ fontSize: 12.5 }}>
                  <div className="mono">{row.version ?? '—'}</div>
                  <div className="muted">
                    {row.platform ?? (row.target_platform ? row.target_platform || '通用' : '—')}
                  </div>
                </div>
              ),
            },
            {
              title: '大小',
              dataIndex: 'size_bytes',
              width: 100,
              render: (value: number) => formatBytes(value),
            },
            {
              title: 'SHA256',
              dataIndex: 'sha256',
              width: 210,
              render: (value: string) => <Sha256 value={value} />,
            },
            {
              title: '下载',
              dataIndex: 'download_count',
              width: 80,
              render: (value: number) => formatNumber(value),
            },
            {
              title: '校验',
              dataIndex: 'verified_at',
              width: 120,
              render: (value: string | null) =>
                value ? (
                  <Tooltip title={`校验时间 ${formatDate(value)}`}>
                    <Tag color="green" icon={<SafetyCertificateOutlined />} style={{ borderRadius: 999 }}>
                      已校验
                    </Tag>
                  </Tooltip>
                ) : (
                  <Tag style={{ borderRadius: 999 }}>未校验</Tag>
                ),
            },
            {
              title: '入库时间',
              dataIndex: 'created_at',
              width: 150,
              render: (value?: string) => (
                <span className="muted" style={{ fontSize: 12 }}>{formatDate(value)}</span>
              ),
            },
            {
              title: '操作',
              key: 'actions',
              width: 220,
              fixed: 'right',
              render: (_, row) => (
                <div className="toolbar-inline" style={{ gap: 2 }}>
                  <DownloadButton
                    resourceType={row.type}
                    artifactId={row.id}
                    filename={row.filename}
                    label="下载"
                    size="small"
                    buttonType="link"
                  />
                  <Button
                    size="small"
                    type="link"
                    loading={verifying === row.id}
                    onClick={() => void verify(row)}
                  >
                    校验
                  </Button>
                  <Popconfirm
                    title="删除该资源？"
                    description="文件与索引会一并删除，且不可恢复。"
                    okText="删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => void remove(row)}
                  >
                    <Button size="small" type="link" danger>
                      删除
                    </Button>
                  </Popconfirm>
                </div>
              ),
            },
          ]}
          locale={{ emptyText: '该类型下暂无资源' }}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <Pagination
            current={data?.page ?? page}
            pageSize={data?.pageSize ?? 20}
            total={data?.total ?? 0}
            showTotal={(total) => `共 ${total} 个资源`}
            onChange={(nextPage) => setPage(nextPage)}
          />
        </div>
      </div>

      <div className="panel panel-tight" style={{ color: '#6b7f94', fontSize: 12.5 }}>
        <DatabaseOutlined /> 存储目录由环境变量 <code>STORAGE_DIR</code> 指定，默认位于
        <code>data/files</code>。手动复制文件时请保持目录结构：
        <code>vscode/stable/&lt;version&gt;/&lt;platform&gt;/</code>、
        <code>remote-server/&lt;version&gt;/&lt;commit&gt;/&lt;platform&gt;/</code>、
        <code>extensions/&lt;publisher&gt;/&lt;name&gt;/&lt;version&gt;/</code>。
        删除前请确认没有任务在引用该资源。
      </div>
    </div>
  );
}
