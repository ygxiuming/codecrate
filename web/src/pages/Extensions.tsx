import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Descriptions,
  Drawer,
  Empty,
  Input,
  Pagination,
  Select,
  Skeleton,
  Tag,
} from 'antd';
import { AppstoreOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../api/client';
import type {
  ExtensionItem,
  ExtensionListResponse,
  ExtensionVersion,
} from '../api/types';
import { DownloadButton } from '../components/DownloadButton';
import { ExtensionCard } from '../components/ExtensionCard';
import { Sha256 } from '../components/Sha256';
import { formatBytes, formatDate, formatDay, formatNumber, platformLabel } from '../lib/format';
import { trackSearch } from '../lib/tracker';

export function ExtensionsPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const category = params.get('category') ?? '';
  const sort = params.get('sort') ?? 'downloads';
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);

  const [keyword, setKeyword] = useState(q);
  const [data, setData] = useState<ExtensionListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ExtensionItem | null>(null);
  const [versions, setVersions] = useState<ExtensionVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);

  useEffect(() => {
    setKeyword(q);
  }, [q]);

  const updateParams = (patch: Record<string, string | undefined>, resetPage = true): void => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === '') next.delete(key);
      else next.set(key, value);
    }
    if (resetPage) next.delete('page');
    setParams(next, { replace: true });
  };

  const load = useCallback(() => {
    setLoading(true);
    api
      .get<ExtensionListResponse>(
        `/api/public/extensions${qs({ q, category, sort, page, pageSize: 12 })}`,
      )
      .then(setData)
      .catch(() =>
        setData({ items: [], total: 0, page: 1, pageSize: 12, categories: [] }),
      )
      .finally(() => setLoading(false));
  }, [q, category, sort, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    setVersionsLoading(true);
    api
      .get<{ versions: ExtensionVersion[] }>(
        `/api/public/extensions/${encodeURIComponent(selected.id)}/versions`,
      )
      .then((result) => {
        if (active) setVersions(result.versions);
      })
      .catch(() => {
        if (active) setVersions([]);
      })
      .finally(() => {
        if (active) setVersionsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selected]);

  const submitSearch = (): void => {
    const value = keyword.trim();
    if (value) trackSearch(value);
    updateParams({ q: value || undefined });
  };

  return (
    <>
      <div className="docs-hero">
        <div className="container">
          <h1>
            <AppstoreOutlined style={{ color: '#0078d4', marginRight: 10 }} />
            离线插件市场
          </h1>
          <p>已缓存的 .vsix 插件包，可直接下载并通过命令行或 VS Code 图形界面安装。</p>
        </div>
      </div>

      <div className="container section">
        <div className="toolbar">
          <Input
            allowClear
            style={{ width: 300 }}
            prefix={<SearchOutlined style={{ color: '#7c93a9' }} />}
            placeholder="搜索插件名、Publisher 或描述"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onPressEnter={submitSearch}
          />
          <Button type="primary" onClick={submitSearch}>
            搜索
          </Button>
          <Select
            allowClear
            style={{ width: 200 }}
            placeholder="全部分类"
            value={category || undefined}
            options={(data?.categories ?? []).map((item) => ({ value: item, label: item }))}
            onChange={(value) => updateParams({ category: value })}
          />
          <Select
            style={{ width: 160 }}
            value={sort}
            options={[
              { value: 'downloads', label: '按下载量' },
              { value: 'updated', label: '按更新时间' },
              { value: 'name', label: '按名称' },
            ]}
            onChange={(value) => updateParams({ sort: value })}
          />
          <Button icon={<ReloadOutlined />} onClick={load}>
            刷新
          </Button>
          <span style={{ marginLeft: 'auto', color: '#6b7f94', fontSize: 12.5 }}>
            共 {formatNumber(data?.total ?? 0)} 个插件
          </span>
        </div>

        {loading ? (
          <div className="ext-grid">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="panel">
                <Skeleton active avatar paragraph={{ rows: 3 }} />
              </div>
            ))}
          </div>
        ) : data && data.items.length > 0 ? (
          <>
            <div className="ext-grid">
              {data.items.map((item) => (
                <ExtensionCard key={item.id} item={item} onClick={() => setSelected(item)} />
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 26 }}>
              <Pagination
                current={data.page}
                pageSize={data.pageSize}
                total={data.total}
                showTotal={(total) => `共 ${total} 个插件`}
                onChange={(nextPage) => updateParams({ page: String(nextPage) }, false)}
              />
            </div>
          </>
        ) : (
          <div className="panel empty-wrap">
            <Empty description="没有符合条件的已缓存插件">
              <a href="/docs?tab=admin-guide">查看管理员上传与缓存指南</a>
            </Empty>
          </div>
        )}
      </div>

      <Drawer
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        width={600}
        title={selected ? `${selected.displayName} · ${selected.publisher}` : '插件详情'}
      >
        {selected ? (
          <div className="stack">
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div className="ext-icon" style={{ width: 58, height: 58, fontSize: 22 }}>
                {selected.iconUrl ? (
                  <img src={selected.iconUrl} alt="" />
                ) : (
                  selected.displayName.slice(0, 1).toUpperCase()
                )}
              </div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{selected.displayName}</div>
                <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
                  {selected.id} · 最新版本 v{selected.version}
                </div>
              </div>
            </div>

            <div className="chip-row">
              {selected.categories.map((item) => (
                <Tag key={item} style={{ borderRadius: 999 }}>
                  {item}
                </Tag>
              ))}
              {selected.engineRange ? (
                <Tag color="blue" style={{ borderRadius: 999 }}>
                  VS Code {selected.engineRange}
                </Tag>
              ) : null}
            </div>

            <p style={{ color: '#425466', lineHeight: 1.85, margin: 0, whiteSpace: 'pre-wrap' }}>
              {selected.description || '暂无描述'}
            </p>

            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label="Publisher">{selected.publisher}</Descriptions.Item>
              <Descriptions.Item label="下载量">
                {formatNumber(selected.downloadCount)}
              </Descriptions.Item>
              <Descriptions.Item label="版本数">{selected.versionsCount}</Descriptions.Item>
              <Descriptions.Item label="更新时间">
                {formatDate(selected.updatedAt)}
              </Descriptions.Item>
              <Descriptions.Item label="平台" span={2}>
                {selected.platforms.map(platformLabel).join(' / ')}
              </Descriptions.Item>
              <Descriptions.Item label="依赖" span={2}>
                {selected.dependencies.length > 0 ? (
                  <span className="mono" style={{ fontSize: 12.5, lineHeight: 1.9 }}>
                    {selected.dependencies.join(', ')}
                  </span>
                ) : (
                  <span className="muted">无</span>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Extension Pack" span={2}>
                {selected.extensionPack.length > 0 ? (
                  <span className="mono" style={{ fontSize: 12.5, lineHeight: 1.9 }}>
                    {selected.extensionPack.join(', ')}
                  </span>
                ) : (
                  <span className="muted">无</span>
                )}
              </Descriptions.Item>
            </Descriptions>

            <div>
              <div className="row-between" style={{ marginBottom: 10 }}>
                <strong style={{ fontSize: 14 }}>可下载版本</strong>
                <span className="muted" style={{ fontSize: 12 }}>
                  下载后使用 code --install-extension 安装
                </span>
              </div>
              {versionsLoading ? (
                <Skeleton active paragraph={{ rows: 3 }} />
              ) : versions.length > 0 ? (
                <div className="stack" style={{ gap: 10 }}>
                  {versions.map((version) => (
                    <div
                      key={`${version.version}-${version.targetPlatform}`}
                      className="panel panel-tight"
                      style={{ boxShadow: 'none' }}
                    >
                      <div className="row-between">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <strong>v{version.version}</strong>
                          <span className="tag-soft">{platformLabel(version.targetPlatform)}</span>
                          {version.engineRange ? (
                            <span className="tag-soft">VS Code {version.engineRange}</span>
                          ) : null}
                          <span className="muted" style={{ fontSize: 12 }}>
                            {formatBytes(version.sizeBytes)} · {formatDay(version.publishedAt)}
                          </span>
                        </div>
                        <DownloadButton
                          resourceType="extension"
                          artifactId={version.artifactId}
                          filename={version.filename}
                          size="small"
                          label="下载 .vsix"
                        />
                      </div>
                      <div style={{ marginTop: 6 }}>
                        <Sha256 value={version.sha256} length={20} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty description="没有可用版本" />
              )}
            </div>
          </div>
        ) : null}
      </Drawer>
    </>
  );
}
