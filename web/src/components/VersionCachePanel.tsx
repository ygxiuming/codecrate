import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Input,
  Modal,
  Pagination,
  Select,
  Space,
  Table,
  Tag,
  Upload,
  message,
} from 'antd';
import {
  BranchesOutlined,
  CloudUploadOutlined,
  CopyOutlined,
  InboxOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { UploadFile } from 'antd/es/upload/interface';
import { Link, useNavigate } from 'react-router-dom';
import { api, qs } from '../api/client';
import type {
  AdminVersionItem,
  AdminVersionsResponse,
  RemoteUploadResult,
} from '../api/types';
import { copyText, formatBytes, formatDate } from '../lib/format';

interface CommitMatch {
  version: string;
  commitHash: string;
  buildTime?: string;
  source: 'cache' | 'probe';
}

interface CommitLookupResult {
  found: boolean;
  commit: string;
  matches: CommitMatch[];
  warning?: string;
  elapsedMs: number;
}

interface ProbeResult {
  id: string;
  label: string;
  available: boolean;
  sizeBytes?: number;
  filename?: string;
  commitHash?: string;
  buildTime?: string;
  error?: string;
}

export function VersionCachePanel({ mode }: { mode: 'vscode' | 'remote' }) {
  const navigate = useNavigate();
  const [data, setData] = useState<AdminVersionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [selectedVersions, setSelectedVersions] = useState<React.Key[]>([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const initialized = useRef(false);
  const [force, setForce] = useState(false);
  const [probe, setProbe] = useState<{ version: string; results: ProbeResult[] } | null>(null);
  const [probing, setProbing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [commitInput, setCommitInput] = useState('');
  const [commitLoading, setCommitLoading] = useState(false);
  const [commitResult, setCommitResult] = useState<CommitLookupResult | null>(null);
  const [resolvedCommits, setResolvedCommits] = useState<Record<string, string>>({});
  const [resolving, setResolving] = useState<string | null>(null);
  const [resolvingMissing, setResolvingMissing] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadVersion, setUploadVersion] = useState('');
  const [uploadPlatform, setUploadPlatform] = useState<string | undefined>();
  const [uploadCommit, setUploadCommit] = useState('');
  const [uploadResult, setUploadResult] = useState<RemoteUploadResult | null>(null);

  const versionsEndpoint = mode === 'vscode' ? '/api/admin/vscode/versions' : '/api/admin/remote/versions';
  const cacheEndpoint = mode === 'vscode' ? '/api/admin/vscode/cache' : '/api/admin/remote/cache';

  const load = useCallback(() => {
    setLoading(true);
    api
      .get<AdminVersionsResponse>(`${versionsEndpoint}${qs({ page, pageSize: 20, q })}`)
      .then((result) => {
        setData(result);
        if (!initialized.current) {
          setSelectedPlatforms(result.defaultPlatforms);
          initialized.current = true;
        }
      })
      .catch((error) => {
        message.error((error as Error).message);
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [page, q, versionsEndpoint]);

  useEffect(() => {
    load();
  }, [load]);

  const probeVersion = async (version: string): Promise<void> => {
    setProbing(true);
    try {
      const result = await api.post<{ version: string; platforms: ProbeResult[] }>(
        '/api/admin/vscode/probe',
        { version },
      );
      setProbe({ version: result.version, results: result.platforms });
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setProbing(false);
    }
  };

  const selectVersion = (version: string): void => {
    setSelectedVersions((current) => (current.includes(version) ? current : [...current, version]));
    message.success(`已将版本 ${version} 加入缓存选择`);
  };

  const lookupCommit = async (): Promise<void> => {
    const commit = commitInput.trim().toLowerCase();
    if (!/^[0-9a-f]{7,40}$/.test(commit)) {
      message.warning('请输入 7-40 位十六进制 commit');
      return;
    }
    setCommitLoading(true);
    try {
      const result = await api.post<CommitLookupResult>('/api/admin/vscode/commit-lookup', {
        commit,
      });
      setCommitResult(result);
      if (result.found && result.matches[0]) {
        selectVersion(result.matches[0].version);
      } else {
        message.warning(result.warning ?? '未找到匹配版本');
      }
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setCommitLoading(false);
    }
  };

  const fetchCommit = async (version: string): Promise<string | null> => {
    const result = await api.get<{ version: string; commitHash?: string | null }>(
      `/api/admin/vscode/${encodeURIComponent(version)}/commit`,
    );
    return result.commitHash ?? null;
  };

  const resolveCommit = async (version: string): Promise<void> => {
    setResolving(version);
    try {
      const commit = await fetchCommit(version);
      if (!commit) {
        message.warning(`未能解析 ${version} 的 commit`);
        return;
      }
      setResolvedCommits((current) => ({ ...current, [version]: commit }));
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setResolving(null);
    }
  };

  const copyCommit = async (commit: string): Promise<void> => {
    if (await copyText(commit)) message.success('commit 已复制');
  };

  const resolveMissingCommits = async (): Promise<void> => {
    const versions = (data?.items ?? [])
      .filter((item) => !item.commitHash && !resolvedCommits[item.version])
      .map((item) => item.version);
    if (versions.length === 0) {
      message.info('本页 commit 已全部显示');
      return;
    }
    setResolvingMissing(true);
    let resolved = 0;
    let failed = 0;
    try {
      for (let index = 0; index < versions.length; index += 4) {
        const chunk = versions.slice(index, index + 4);
        const entries = await Promise.all(
          chunk.map(async (version) => {
            try {
              return [version, await fetchCommit(version)] as const;
            } catch {
              return [version, null] as const;
            }
          }),
        );
        const patch: Record<string, string> = {};
        for (const [version, commit] of entries) {
          if (commit) {
            patch[version] = commit;
            resolved += 1;
          } else {
            failed += 1;
          }
        }
        if (Object.keys(patch).length > 0) {
          setResolvedCommits((current) => ({ ...current, ...patch }));
        }
      }
      message.success(
        failed > 0 ? `已解析 ${resolved} 个 commit，${failed} 个失败` : `已解析 ${resolved} 个 commit`,
      );
    } finally {
      setResolvingMissing(false);
    }
  };

  const openUpload = (): void => {
    setUploadFile(null);
    setUploadVersion('');
    setUploadPlatform(undefined);
    setUploadCommit('');
    setUploadResult(null);
    setUploadOpen(true);
  };

  const submitUpload = async (): Promise<void> => {
    if (!uploadFile) {
      message.warning('请选择要上传的 server 包');
      return;
    }
    setUploading(true);
    try {
      const result = await api.upload<RemoteUploadResult>(
        '/api/admin/remote/upload',
        uploadFile,
        'file',
        {
          version: uploadVersion.trim() || undefined,
          platform: uploadPlatform,
          commit: uploadCommit.trim() || undefined,
        },
      );
      setUploadResult(result);
      setResolvedCommits((current) => ({ ...current, [result.version]: result.commitHash }));
      message.success(`已导入 ${result.version} / ${result.platform}`);
      load();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const submit = (): void => {
    if (selectedVersions.length === 0) {
      message.warning('请先选择要缓存的版本');
      return;
    }
    if (selectedPlatforms.length === 0) {
      message.warning('请至少选择一个平台');
      return;
    }
    const total = selectedVersions.length * selectedPlatforms.length;
    if (total > 60) {
      message.warning('单次最多 60 个任务，请减少版本或平台数量');
      return;
    }
    Modal.confirm({
      title: '确认创建缓存任务',
      content: (
        <div style={{ lineHeight: 1.9 }}>
          <div>
            版本 <strong>{selectedVersions.length}</strong> 个 × 平台{' '}
            <strong>{selectedPlatforms.length}</strong> 个 = <strong>{total}</strong> 个下载任务。
          </div>
          <div style={{ color: '#6b7f94', fontSize: 12.5 }}>
            {mode === 'vscode'
              ? '每个任务会下载一个平台安装包，失败可单独重试。'
              : '系统会先解析对应 commit，再下载 server 包。'}
          </div>
          {force ? <div style={{ color: '#d97706', fontSize: 12.5 }}>已启用强制重新缓存，已有资源会被覆盖。</div> : null}
        </div>
      ),
      okText: '开始缓存',
      cancelText: '取消',
      onOk: async () => {
        setSubmitting(true);
        try {
          const result = await api.post<{
            created: Array<{ version: string; platform: string; taskId: number }>;
            skipped: Array<{ version: string; platform: string; reason: string }>;
          }>(cacheEndpoint, {
            versions: selectedVersions,
            platforms: selectedPlatforms,
            force,
          });
          message.success(
            `已创建 ${result.created.length} 个任务，跳过 ${result.skipped.length} 个（已缓存或已存在）`,
          );
          load();
          if (result.created.length > 0) navigate('/admin/tasks');
        } catch (error) {
          message.error((error as Error).message);
        } finally {
          setSubmitting(false);
        }
      },
    });
    void submitting;
  };

  const columns: ColumnsType<AdminVersionItem> = [
    {
      title: '版本',
      dataIndex: 'version',
      width: 150,
      render: (version: string) => <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{version}</strong>,
    },
    {
      title: mode === 'vscode' ? '已缓存平台' : '已缓存 server 平台',
      key: 'cached',
      render: (_, row) =>
        row.cachedCount > 0 ? (
          <Space size={[4, 4]} wrap>
            {row.cachedPlatforms.map((platform) => (
              <Tag color="green" key={platform} style={{ borderRadius: 999 }}>
                {platform}
              </Tag>
            ))}
          </Space>
        ) : (
          <Tag style={{ borderRadius: 999 }}>未缓存</Tag>
        ),
    },
  ];

  columns.push({
    title: 'commit',
    dataIndex: 'commitHash',
    width: 330,
    render: (value: string | null, row) => {
      const commit = value || resolvedCommits[row.version];
      if (commit) {
        return (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
            <span
              className="mono"
              style={{ fontSize: 11.5, lineHeight: 1.5, wordBreak: 'break-all' }}
            >
              {commit}
            </span>
            <button
              type="button"
              className="copy-btn"
              onClick={() => void copyCommit(commit)}
              aria-label="复制 commit"
            >
              <CopyOutlined />
            </button>
          </div>
        );
      }
      return (
        <Button
          size="small"
          type="link"
          style={{ padding: 0 }}
          loading={resolving === row.version}
          onClick={() => void resolveCommit(row.version)}
        >
          解析 commit
        </Button>
      );
    },
  });

  columns.push({
    title: '操作',
    key: 'actions',
    width: 130,
    render: (_, row) =>
      mode === 'vscode' ? (
        <Button size="small" loading={probing} onClick={() => void probeVersion(row.version)}>
          探测平台
        </Button>
      ) : (
        <span className="muted" style={{ fontSize: 12 }}>
          {row.cachedCount > 0 ? '已缓存' : '可缓存'}
        </span>
      ),
  });

  return (
    <div className="stack">
      {mode === 'remote' ? (
        <Alert
          type="info"
          showIcon
          message="两种采集方式"
          style={{ borderRadius: 12 }}
          description={
            <div style={{ display: 'grid', gap: 6, fontSize: 12.5 }}>
              <div>
                自动缓存：从镜像源 <code>{data?.remoteDownloadBase || '未配置'}</code>{' '}
                按 <code>commit:&lt;commit&gt;/server-&lt;platform&gt;/stable</code> 解析并下载到本系统。
              </div>
              <div>
                手动导入：在可联网机器下载 <code>vscode-server-&lt;platform&gt;.tar.gz/.zip</code>，
                再用下方「手动上传 server 包」导入，系统会读取包内 product.json 自动识别版本与 commit。
              </div>
              <div>
                VS Code 接入：设置 <code>remote.SSH.useOSS: true</code> 与{' '}
                <code>remote.SSH.ossDownloadUrl: {data?.vscodeUpdateBase ?? `${window.location.origin}/api/vscode-update`}</code>
                ，远端即可自动从本源下载；客户端推送方案见{' '}
                <Link to="/docs?tab=remote-ssh">Remote-SSH 文档</Link>。
              </div>
              <div>
                <Link to="/admin/settings">修改镜像源地址</Link>
                {' · '}
                单个文件上限 {formatBytes(data?.remoteUploadMaxBytes ?? 1024 * 1024 * 1024)}
              </div>
            </div>
          }
        />
      ) : null}

      {data && !data.sourceAvailable ? (
        <Alert
          type="warning"
          showIcon
          message="官方版本源当前不可达"
          description={
            <div style={{ whiteSpace: 'pre-wrap' }}>
              {data.warning ?? '当前仅展示已缓存的版本，请检查网络或数据源配置。'}
            </div>
          }
          style={{ borderRadius: 12 }}
        />
      ) : null}

      <div className="panel">
        <div className="row-between" style={{ marginBottom: 14 }}>
          <div>
            <strong style={{ fontSize: 15 }}>
              {mode === 'vscode' ? '平台选择' : 'Server 平台选择'}
            </strong>
            <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
              已选 {selectedPlatforms.length} 个平台。默认覆盖主流桌面与 Linux 平台，其余在下方勾选。
            </div>
          </div>
          <div className="toolbar-inline">
            <Button
              size="small"
              onClick={() => setSelectedPlatforms(data?.platforms.map((item) => item.id) ?? [])}
            >
              全选
            </Button>
            <Button
              size="small"
              onClick={() => setSelectedPlatforms(data?.defaultPlatforms ?? [])}
            >
              恢复默认
            </Button>
            <Button size="small" onClick={() => setSelectedPlatforms([])}>
              清空
            </Button>
          </div>
        </div>
        <Checkbox.Group
          value={selectedPlatforms}
          onChange={(values) => setSelectedPlatforms(values as string[])}
          style={{ width: '100%' }}
        >
          <div className="platform-check-grid">
            {(data?.platforms ?? []).map((platform) => (
              <Checkbox key={platform.id} value={platform.id}>
                <span style={{ fontSize: 13 }}>{platform.label}</span>
                {platform.defaultSelected ? (
                  <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>
                    默认
                  </span>
                ) : null}
              </Checkbox>
            ))}
          </div>
        </Checkbox.Group>
        <div style={{ marginTop: 14 }}>
          <Checkbox checked={force} onChange={(event) => setForce(event.target.checked)}>
            强制重新缓存（覆盖已有文件）
          </Checkbox>
        </div>
      </div>

      <div className="panel">
        <div className="toolbar-inline" style={{ marginBottom: 14 }}>
          <Input
            allowClear
            style={{ width: 260 }}
            prefix={<SearchOutlined style={{ color: '#7c93a9' }} />}
            placeholder="搜索版本号"
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
          <Button
            loading={resolvingMissing}
            onClick={() => void resolveMissingCommits()}
          >
            自动解析本页 commit
          </Button>
          {mode === 'remote' ? (
            <Button icon={<CloudUploadOutlined />} onClick={openUpload}>
              手动上传 server 包
            </Button>
          ) : null}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="muted" style={{ fontSize: 12.5 }}>
              已选 {selectedVersions.length} 个版本 · {selectedVersions.length * selectedPlatforms.length} 个任务
            </span>
            <Button type="primary" loading={submitting} onClick={submit}>
              缓存所选
            </Button>
          </div>
        </div>

        <div className="toolbar-inline" style={{ marginBottom: 12 }}>
          <Input
            allowClear
            style={{ width: 280 }}
            prefix={<BranchesOutlined style={{ color: '#7c93a9' }} />}
            placeholder="按 commit 查找版本（7-40 位十六进制）"
            value={commitInput}
            onChange={(event) => setCommitInput(event.target.value)}
            onPressEnter={() => void lookupCommit()}
          />
          <Button loading={commitLoading} onClick={() => void lookupCommit()}>
            查找 commit
          </Button>
          <span className="muted" style={{ fontSize: 12 }}>
            与客户端「帮助 → 关于」中的 commit 匹配；未缓存时会在最近 150 个稳定版中探测
          </span>
        </div>

        {commitResult ? (
          <Alert
            style={{ marginBottom: 12, borderRadius: 10 }}
            type={commitResult.found ? 'success' : 'warning'}
            showIcon
            closable
            onClose={() => setCommitResult(null)}
            message={
              commitResult.found
                ? `commit ${commitResult.commit} 匹配到 ${commitResult.matches.length} 个版本`
                : `未找到 commit ${commitResult.commit}`
            }
            description={
              commitResult.found ? (
                <div>
                  {commitResult.matches.map((match) => (
                    <Tag
                      key={`${match.version}-${match.commitHash}`}
                      color="blue"
                      style={{ borderRadius: 999, cursor: 'pointer', marginBottom: 4 }}
                      onClick={() => selectVersion(match.version)}
                    >
                      VS Code {match.version} · {match.source === 'cache' ? '本地索引' : '官方探测'}
                    </Tag>
                  ))}
                  <span className="muted" style={{ fontSize: 12 }}>
                    耗时 {commitResult.elapsedMs} ms，点击版本可加入选择。
                  </span>
                </div>
              ) : (
                <span style={{ fontSize: 12.5 }}>{commitResult.warning}</span>
              )
            }
          />
        ) : null}

        <Table<AdminVersionItem>
          rowKey="version"
          size="middle"
          loading={loading}
          dataSource={data?.items ?? []}
          columns={columns}
          pagination={false}
          scroll={{ x: 1100 }}
          rowSelection={{
            selectedRowKeys: selectedVersions,
            onChange: (keys) => setSelectedVersions(keys),
            preserveSelectedRowKeys: true,
          }}
          locale={{ emptyText: '没有可用版本' }}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <Pagination
            current={data?.page ?? 1}
            pageSize={data?.pageSize ?? 20}
            total={data?.total ?? 0}
            showSizeChanger={false}
            showTotal={(total) => `共 ${total} 个版本`}
            onChange={(nextPage) => setPage(nextPage)}
          />
        </div>
      </div>

      {mode === 'remote' ? (
        <Modal
          open={uploadOpen}
          title="手动上传 Remote-SSH Server 包"
          onCancel={() => setUploadOpen(false)}
          width={640}
          footer={[
            <Button key="close" onClick={() => setUploadOpen(false)}>
              关闭
            </Button>,
            <Button
              key="upload"
              type="primary"
              loading={uploading}
              onClick={() => void submitUpload()}
            >
              上传并入库
            </Button>,
          ]}
        >
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 14, borderRadius: 10 }}
            message="系统会读取包内 product.json 自动识别版本与 commit"
            description={
              <span style={{ fontSize: 12.5 }}>
                适用于无法出网的环境：在可联网机器下载标准 server 包后上传。平台优先按
                {' '}
                <code>vscode-server-&lt;platform&gt;.tar.gz/.zip</code>
                {' '}
                文件名识别，也可手动选择。
              </span>
            }
          />
          <Upload.Dragger
            accept=".tar.gz,.tgz,.zip"
            maxCount={1}
            beforeUpload={(file) => {
              setUploadFile(file);
              setUploadResult(null);
              return false;
            }}
            onRemove={() => {
              setUploadFile(null);
              return true;
            }}
            fileList={
              (uploadFile
                ? [{ uid: '-1', name: uploadFile.name, status: 'done' }]
                : []) as UploadFile[]
            }
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">点击或拖拽 server 包到此处</p>
            <p className="ant-upload-hint">
              支持 .tar.gz / .tgz / .zip，单个文件最大{' '}
              {formatBytes(data?.remoteUploadMaxBytes ?? 1024 * 1024 * 1024)}
            </p>
          </Upload.Dragger>

          <Space direction="vertical" style={{ width: '100%', marginTop: 16 }}>
            <Input
              allowClear
              placeholder="VS Code 版本号（留空自动识别，例如 1.143.0）"
              value={uploadVersion}
              onChange={(event) => setUploadVersion(event.target.value)}
            />
            <Select
              allowClear
              style={{ width: '100%' }}
              placeholder="server 平台（留空按文件名识别）"
              value={uploadPlatform}
              options={(data?.platforms ?? []).map((item) => ({
                value: item.id,
                label: item.label,
              }))}
              onChange={(value) => setUploadPlatform(value)}
            />
            <Input
              allowClear
              placeholder="commit（留空自动识别，40 位十六进制）"
              value={uploadCommit}
              onChange={(event) => setUploadCommit(event.target.value)}
            />
          </Space>

          {uploadResult ? (
            <Alert
              type="success"
              showIcon
              style={{ marginTop: 14, borderRadius: 10 }}
              message={`已导入 VS Code ${uploadResult.version} · ${uploadResult.platform}`}
              description={
                <div style={{ fontSize: 12.5, lineHeight: 1.9 }}>
                  <div>
                    commit <code>{uploadResult.commitHash}</code>
                  </div>
                  <div>
                    文件 <code>{uploadResult.filename}</code> · {formatBytes(uploadResult.sizeBytes)}
                  </div>
                  <div className="mono" style={{ wordBreak: 'break-all' }}>
                    SHA256 {uploadResult.sha256}
                  </div>
                </div>
              }
            />
          ) : null}
        </Modal>
      ) : null}

      <Modal
        open={Boolean(probe)}
        title={probe ? `平台可用性探测 · VS Code ${probe.version}` : '平台探测'}
        onCancel={() => setProbe(null)}
        width={720}
        footer={[
          <Button key="close" onClick={() => setProbe(null)}>
            关闭
          </Button>,
          <Button
            key="select"
            type="primary"
            onClick={() => {
              const available = probe?.results.filter((item) => item.available).map((item) => item.id) ?? [];
              setSelectedPlatforms(available);
              setProbe(null);
              message.success(`已选中 ${available.length} 个可用平台`);
            }}
          >
            选中可用平台
          </Button>,
        ]}
      >
        <Table<ProbeResult>
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={probe?.results ?? []}
          columns={[
            { title: '平台', dataIndex: 'label' },
            {
              title: '状态',
              dataIndex: 'available',
              width: 90,
              render: (available: boolean) =>
                available ? <Tag color="green">可用</Tag> : <Tag color="red">不可用</Tag>,
            },
            {
              title: '大小',
              dataIndex: 'sizeBytes',
              width: 110,
              render: (value: number) => (value ? formatBytes(value) : '—'),
            },
            {
              title: '说明',
              key: 'note',
              render: (_, row) =>
                row.available ? (
                  <span className="muted" style={{ fontSize: 12 }}>
                    {row.filename}
                    {row.buildTime ? ` · ${formatDate(row.buildTime, 'YYYY-MM-DD')}` : ''}
                  </span>
                ) : (
                  <span style={{ color: '#d92d20', fontSize: 12 }}>{row.error}</span>
                ),
            },
          ]}
          scroll={{ y: 360 }}
        />
      </Modal>
    </div>
  );
}
