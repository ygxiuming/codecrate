import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Empty,
  Input,
  Modal,
  Pagination,
  Select,
  Skeleton,
  Tag,
  Tooltip,
  message,
} from 'antd';
import {
  ApiOutlined,
  CloudServerOutlined,
  CopyOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { api, qs } from '../api/client';
import type { PublicConfig, RemoteVersion } from '../api/types';
import { CodeBlock } from '../components/CodeBlock';
import { DownloadButton } from '../components/DownloadButton';
import { Sha256 } from '../components/Sha256';
import { copyText, formatBytes, formatNumber, shortSha } from '../lib/format';
import { trackSearch } from '../lib/tracker';

interface RemotePlatformInfo {
  id: string;
  label: string;
}

export function RemoteSshPage() {
  const [platforms, setPlatforms] = useState<RemotePlatformInfo[]>([]);
  const [platform, setPlatform] = useState<string | undefined>();
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [data, setData] = useState<{ items: RemoteVersion[]; total: number; page: number; pageSize: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [updateBase, setUpdateBase] = useState(
    () => `${window.location.origin}/api/vscode-update`,
  );
  const [accessVersion, setAccessVersion] = useState<RemoteVersion | null>(null);
  const [accessPlatform, setAccessPlatform] = useState('');

  useEffect(() => {
    void api
      .get<{ remote: RemotePlatformInfo[] }>('/api/public/platforms')
      .then((result) => setPlatforms(result.remote))
      .catch(() => undefined);
    void api
      .get<PublicConfig>('/api/public/config')
      .then((config) => {
        const base = (config.galleryBaseUrl || window.location.origin).replace(/\/+$/, '');
        setUpdateBase(`${base}/api/vscode-update`);
      })
      .catch(() => undefined);
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get<{ items: RemoteVersion[]; total: number; page: number; pageSize: number }>(
        `/api/public/remote-servers${qs({ page, pageSize, platform, q: appliedKeyword })}`,
      )
      .then(setData)
      .catch(() => setData({ items: [], total: 0, page: 1, pageSize }))
      .finally(() => setLoading(false));
  }, [page, pageSize, platform, appliedKeyword]);

  useEffect(() => {
    load();
  }, [load]);

  const search = (): void => {
    setPage(1);
    setAppliedKeyword(keyword.trim());
    if (keyword.trim()) trackSearch(keyword.trim());
  };

  const copyCommit = async (commit: string): Promise<void> => {
    if (await copyText(commit)) message.success('commit 已复制');
  };

  const openAccess = (item: RemoteVersion): void => {
    setAccessVersion(item);
    setAccessPlatform(item.platforms[0]?.id ?? '');
  };

  const accessArtifact =
    accessVersion?.platforms.find((item) => item.id === accessPlatform) ??
    accessVersion?.platforms[0];

  const accessSettings = accessVersion
    ? JSON.stringify(
        {
          'remote.SSH.useOSS': true,
          'remote.SSH.ossDownloadUrl': updateBase,
          'remote.SSH.localServerDownload': 'off',
          'remote.SSH.useExecServer': false,
        },
        null,
        2,
      )
    : '';

  const bootstrapSettings = JSON.stringify(
    {
      'remote.SSH.localServerDownload': 'manual-bootstrap',
      'remote.SSH.useExecServer': false,
    },
    null,
    2,
  );

  const bootstrapCommand =
    accessVersion && accessArtifact
      ? [
          'mkdir -p ~/vscode-remote-ssh-bootstrap',
          `curl -fL "${updateBase}/commit:${accessVersion.commitHash}/server-${accessArtifact.id}/stable" \\`,
          '  -o ~/vscode-remote-ssh-bootstrap/vscode-server.tar.gz',
        ].join('\n')
      : '';

  return (
    <>
      <div className="docs-hero">
        <div className="container">
          <h1>
            <CloudServerOutlined style={{ color: '#0078d4', marginRight: 10 }} />
            Remote-SSH Server
          </h1>
          <p>
            按 VS Code 版本缓存的 vscode-server 离线包。客户端与服务端的 commit 必须一致。
          </p>
        </div>
      </div>

      <div className="container section">
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 18, borderRadius: 12 }}
          message="离线使用 Remote-SSH 的关键"
          description={
            <span>
              先在远端主机预置 <code>~/.vscode-server/bin/&lt;commit&gt;/</code>，再在客户端设置{' '}
              <code>remote.SSH.localServerDownload: "off"</code>。完整步骤与常见错误见{' '}
              <Link to="/docs?tab=remote-ssh">Remote-SSH 离线配置</Link>。
            </span>
          }
        />
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 18, borderRadius: 12 }}
          message="VS Code 自动接入（可选）"
          description={
            <span>
              客户端设置 <code>remote.SSH.useOSS: true</code> 与{' '}
              <code>remote.SSH.ossDownloadUrl: {updateBase}</code> 后，远端主机会按 commit
              自动从本源下载 server；若远端无法访问本源，可用 <code>manual-bootstrap</code>{' '}
              在客户端下载后由扩展自动 SCP 推送。详见{' '}
              <Link to="/docs?tab=remote-ssh">自动接入说明</Link>。
            </span>
          }
        />

        <div className="toolbar">
          <Select
            allowClear
            style={{ width: 220 }}
            placeholder="按 server 平台筛选"
            value={platform}
            options={platforms.map((item) => ({ value: item.id, label: item.label }))}
            onChange={(value) => {
              setPlatform(value);
              setPage(1);
            }}
          />
          <Input
            allowClear
            style={{ width: 240 }}
            prefix={<SearchOutlined style={{ color: '#7c93a9' }} />}
            placeholder="搜索 VS Code 版本号"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onPressEnter={search}
          />
          <Button onClick={search}>搜索</Button>
          <Button icon={<ReloadOutlined />} onClick={load}>
            刷新
          </Button>
          <span style={{ marginLeft: 'auto', color: '#6b7f94', fontSize: 12.5 }}>
            共 {formatNumber(data?.total ?? 0)} 个版本
          </span>
        </div>

        {loading ? (
          <div className="version-list">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="panel">
                <Skeleton active paragraph={{ rows: 3 }} />
              </div>
            ))}
          </div>
        ) : data && data.items.length > 0 ? (
          <>
            <div className="version-list">
              {data.items.map((item) => (
                <article key={item.version} className="version-card">
                  <div className="version-head">
                    <div className="version-title">
                      <h3>VS Code {item.version}</h3>
                      <Tag color="geekblue" style={{ borderRadius: 999 }}>
                        vscode-server
                      </Tag>
                      <Tooltip title={`commit ${item.commitHash}`}>
                        <span className="tag-soft mono">
                          commit {shortSha(item.commitHash, 10)}
                          <button
                            type="button"
                            className="copy-btn"
                            onClick={() => void copyCommit(item.commitHash)}
                            aria-label="复制 commit"
                          >
                            <CopyOutlined />
                          </button>
                        </span>
                      </Tooltip>
                    </div>
                    <div className="version-meta">
                      <span>
                        {item.platforms.length} 个平台 · {formatBytes(item.totalSize)}
                      </span>
                      <span>{formatNumber(item.downloadCount)} 次下载</span>
                      <Button
                        size="small"
                        type="text"
                        icon={<ApiOutlined />}
                        onClick={() => openAccess(item)}
                      >
                        接入 VS Code
                      </Button>
                    </div>
                  </div>
                  <div className="version-body">
                    {item.platforms.map((entry) => (
                      <div key={entry.id} className="platform-row">
                        <div className="platform-name">{entry.label}</div>
                        <div className="platform-size">{formatBytes(entry.sizeBytes)}</div>
                        <Sha256 value={entry.sha256} />
                        <DownloadButton
                          resourceType="remote-server"
                          artifactId={entry.artifactId}
                          filename={entry.filename}
                          label="下载"
                          size="small"
                        />
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24 }}>
              <Pagination
                current={data.page}
                pageSize={data.pageSize}
                total={data.total}
                showSizeChanger
                pageSizeOptions={[10, 20, 50]}
                showTotal={(total) => `共 ${total} 个版本`}
                onChange={(nextPage, nextSize) => {
                  setPage(nextPage);
                  setPageSize(nextSize);
                }}
              />
            </div>
          </>
        ) : (
          <div className="panel empty-wrap">
            <Empty description="尚未缓存 Remote-SSH server">
              <div style={{ color: '#6b7f94', fontSize: 12.5, marginBottom: 12 }}>
                缓存成功后，这里会按 VS Code 版本显示对应的 commit、平台、大小与 SHA256。
                管理员可在后台自动缓存或手动上传 server 包。
              </div>
              <Link to="/docs?tab=admin-guide">查看管理员缓存指南</Link>
            </Empty>
          </div>
        )}
      </div>

      <Modal
        open={Boolean(accessVersion)}
        title={
          <span>
            <ApiOutlined style={{ color: '#0078d4', marginRight: 8 }} />
            接入 VS Code · VS Code {accessVersion?.version}
          </span>
        }
        width={720}
        onCancel={() => setAccessVersion(null)}
        footer={
          <Button onClick={() => setAccessVersion(null)}>关闭</Button>
        }
      >
        {accessVersion ? (
          <div className="stack">
            <Alert
              type="info"
              showIcon
              style={{ borderRadius: 10 }}
              message="commit 必须与客户端一致"
              description={
                <span style={{ fontSize: 12.5 }}>
                  当前 commit <code className="mono">{accessVersion.commitHash}</code>。
                  平台选择的是<strong>远端主机</strong>架构，不是客户端系统。
                </span>
              }
            />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                远端平台
              </div>
              <Select
                style={{ width: '100%' }}
                value={accessArtifact?.id}
                options={accessVersion.platforms.map((item) => ({
                  value: item.id,
                  label: `${item.label} (${item.id})`,
                }))}
                onChange={(value) => setAccessPlatform(value)}
              />
            </div>

            <div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                方式 A：远端主机直接下载（推荐）
              </div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                适用于 Linux/macOS 远端，且远端能访问本源。写入客户端 VS Code 设置：
              </div>
              <CodeBlock code={accessSettings} />
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                设置后重新连接，远端会按 commit 自动从本源下载并安装 server。Windows
                远端建议使用手动预置方式。
              </div>
            </div>

            <div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                方式 B：客户端下载后由扩展自动 SCP 推送
              </div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                适用于远端不能访问本源、但客户端可以的情况。先在客户端执行：
              </div>
              <CodeBlock code={bootstrapCommand} />
              <div className="muted" style={{ fontSize: 12, margin: '8px 0' }}>
                再写入以下客户端设置，然后正常连接：
              </div>
              <CodeBlock code={bootstrapSettings} />
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                扩展会在连接时自动把 tarball 推送到远端并安装。该模式不支持 Windows
                远端主机。
              </div>
            </div>

            <div className="muted" style={{ fontSize: 12 }}>
              完整说明与排错见{' '}
              <Link to="/docs?tab=remote-ssh" onClick={() => setAccessVersion(null)}>
                Remote-SSH 自动接入文档
              </Link>
              。
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
