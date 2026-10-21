import { useCallback, useEffect, useState } from 'react';
import { Button, Empty, Input, Pagination, Select, Skeleton, Tag, Tooltip } from 'antd';
import {
  CheckCircleOutlined,
  CodeOutlined,
  DownloadOutlined,
  FileProtectOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { api, qs } from '../api/client';
import type { PlatformInfo, VscodeListResponse } from '../api/types';
import { DownloadButton } from '../components/DownloadButton';
import { Sha256 } from '../components/Sha256';
import { downloadText, formatBytes, formatDate, formatNumber, shortSha } from '../lib/format';
import { trackClick, trackSearch } from '../lib/tracker';

export function VscodePage() {
  const [platforms, setPlatforms] = useState<PlatformInfo[]>([]);
  const [platform, setPlatform] = useState<string | undefined>();
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);
  const [data, setData] = useState<VscodeListResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void api
      .get<{ vscode: PlatformInfo[] }>('/api/public/platforms')
      .then((result) => setPlatforms(result.vscode))
      .catch(() => undefined);
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get<VscodeListResponse>(
        `/api/public/vscode${qs({
          page,
          pageSize,
          platform,
          q: appliedKeyword,
        })}`,
      )
      .then(setData)
      .catch(() => setData({ items: [], total: 0, page: 1, pageSize, channel: 'stable' }))
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

  const checksumFile = (version: string): void => {
    const item = data?.items.find((entry) => entry.version === version);
    if (!item) return;
    const content =
      item.platforms.map((entry) => `${entry.sha256}  ${entry.filename}`).join('\n') + '\n';
    downloadText(`vscode-${version}-sha256.txt`, content);
    trackClick('download_checksums');
  };

  return (
    <>
      <div className="docs-hero">
        <div className="container">
          <div className="row-between">
            <div>
              <h1>
                <CodeOutlined style={{ color: '#0078d4', marginRight: 10 }} />
                VS Code 安装包
              </h1>
              <p>仅展示已缓存到内网的版本。下载后可使用附带的 SHA256 校验文件核验完整性。</p>
            </div>
            <Tag color="green" icon={<CheckCircleOutlined />} style={{ borderRadius: 999 }}>
              离线可用
            </Tag>
          </div>
        </div>
      </div>

      <div className="container section">
        <div className="toolbar">
          <Select
            allowClear
            style={{ width: 240 }}
            placeholder="按平台筛选"
            value={platform}
            options={platforms.map((item) => ({ value: item.id, label: item.label }))}
            onChange={(value) => {
              setPlatform(value);
              setPage(1);
            }}
          />
          <Input
            allowClear
            style={{ width: 260 }}
            prefix={<SearchOutlined style={{ color: '#7c93a9' }} />}
            placeholder="搜索版本号，例如 1.95"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onPressEnter={search}
          />
          <Button onClick={search}>搜索</Button>
          <Button icon={<ReloadOutlined />} onClick={load}>
            刷新
          </Button>
          <span style={{ marginLeft: 'auto', color: '#6b7f94', fontSize: 12.5 }}>
            共 {formatNumber(data?.total ?? 0)} 个已缓存版本
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
                      <Tag color="blue" style={{ borderRadius: 999 }}>
                        稳定版
                      </Tag>
                      {item.commitHash ? (
                        <Tooltip title={`commit ${item.commitHash}`}>
                          <span className="tag-soft mono">
                            commit {shortSha(item.commitHash, 8)}
                          </span>
                        </Tooltip>
                      ) : null}
                    </div>
                    <div className="version-meta">
                      <span>构建时间 {formatDate(item.buildTime, 'YYYY-MM-DD')}</span>
                      <span>
                        {item.platforms.length} 个平台 · {formatBytes(item.totalSize)}
                      </span>
                      <span>{formatNumber(item.downloadCount)} 次下载</span>
                      <Button
                        size="small"
                        type="text"
                        icon={<FileProtectOutlined />}
                        onClick={() => checksumFile(item.version)}
                      >
                        SHA256 校验文件
                      </Button>
                    </div>
                  </div>
                  <div className="version-body">
                    {item.platforms.map((entry) => (
                      <div key={entry.id} className="platform-row">
                        <div className="platform-name">
                          <DownloadOutlined style={{ color: '#7a93a9' }} />
                          {entry.label}
                        </div>
                        <div className="platform-size">{formatBytes(entry.sizeBytes)}</div>
                        <Sha256 value={entry.sha256} />
                        <DownloadButton
                          resourceType="vscode"
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
                pageSizeOptions={[8, 16, 32]}
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
            <Empty
              description={
                platform || appliedKeyword
                  ? '没有符合筛选条件的已缓存版本'
                  : '尚未缓存任何 VS Code 版本'
              }
            >
              <a href="/docs?tab=admin-guide">查看管理员缓存指南</a>
            </Empty>
          </div>
        )}
      </div>
    </>
  );
}
