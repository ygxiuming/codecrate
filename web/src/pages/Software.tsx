import { useCallback, useEffect, useState } from 'react';
import { Button, Descriptions, Drawer, Empty, Input, Pagination, Skeleton, Tag } from 'antd';
import { InboxOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../api/client';
import type {
  SoftwareCategory,
  SoftwareDetail,
  SoftwarePackage,
} from '../api/types';
import { CommentSection } from '../components/CommentSection';
import { DownloadButton } from '../components/DownloadButton';
import { MarkdownView } from '../components/MarkdownView';
import { Sha256 } from '../components/Sha256';
import { formatBytes, formatDate, formatNumber } from '../lib/format';
import { trackSearch } from '../lib/tracker';

interface SoftwareListResponse {
  items: SoftwarePackage[];
  total: number;
  page: number;
  pageSize: number;
}

export function SoftwarePage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const category = params.get('category') ?? '';
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);
  const pageSize = Math.min(50, Math.max(10, Number(params.get('size') ?? '10') || 10));

  const [keyword, setKeyword] = useState(q);
  const [data, setData] = useState<SoftwareListResponse | null>(null);
  const [categories, setCategories] = useState<SoftwareCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SoftwareDetail | null>(null);

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
      .get<SoftwareListResponse>(`/api/public/software${qs({ q, category, page, pageSize })}`)
      .then(setData)
      .catch(() => setData({ items: [], total: 0, page: 1, pageSize }))
      .finally(() => setLoading(false));
  }, [q, category, page, pageSize]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api
      .get<{ items: SoftwareCategory[] }>('/api/public/software/categories')
      .then((result) => setCategories(result.items))
      .catch(() => setCategories([]));
  }, []);

  const openDetail = (item: SoftwarePackage): void => {
    setSelected({ ...item, descriptionMd: '', verifiedAt: null, createdAt: item.updatedAt });
    api
      .get<SoftwareDetail>(`/api/public/software/${item.id}`)
      .then(setSelected)
      .catch(() => undefined);
  };

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
            <InboxOutlined style={{ color: '#0078d4', marginRight: 10 }} />
            软件安装包
          </h1>
          <p>管理员发布的常用软件安装包，按分类归档；附说明文档与 SHA256 校验值，可直接下载。</p>
        </div>
      </div>

      <div className="container section">
        <div className="toolbar">
          <Input
            allowClear
            style={{ width: 300 }}
            prefix={<SearchOutlined style={{ color: '#7c93a9' }} />}
            placeholder="搜索软件名、版本或说明"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onPressEnter={submitSearch}
          />
          <Button type="primary" onClick={submitSearch}>
            搜索
          </Button>
          <Button icon={<ReloadOutlined />} onClick={load}>
            刷新
          </Button>
          <span style={{ marginLeft: 'auto', color: '#6b7f94', fontSize: 12.5 }}>
            共 {formatNumber(data?.total ?? 0)} 个安装包
          </span>
        </div>

        {categories.length > 0 ? (
          <div className="chip-row" style={{ margin: '14px 0' }}>
            <Tag.CheckableTag checked={!category} onChange={() => updateParams({ category: undefined })}>
              全部
            </Tag.CheckableTag>
            {categories.map((item) => (
              <Tag.CheckableTag
                key={item.category}
                checked={category === item.category}
                onChange={(checked) => updateParams({ category: checked ? item.category : undefined })}
              >
                {item.category}（{item.count}）
              </Tag.CheckableTag>
            ))}
          </div>
        ) : null}

        {loading ? (
          <div className="ext-grid">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="panel">
                <Skeleton active paragraph={{ rows: 3 }} />
              </div>
            ))}
          </div>
        ) : data && data.items.length > 0 ? (
          <>
            <div className="ext-grid">
              {data.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="panel software-card"
                  onClick={() => openDetail(item)}
                  style={{ textAlign: 'left', cursor: 'pointer' }}
                >
                  <div className="row-between">
                    <strong style={{ fontSize: 15 }}>{item.name}</strong>
                    <span className="tag-soft">{item.category}</span>
                  </div>
                  <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                    {item.version ? `v${item.version}` : '版本未标注'}
                    {item.platform ? ` · ${item.platform}` : ''}
                  </div>
                  <div className="muted" style={{ fontSize: 12.5, marginTop: 8, wordBreak: 'break-all' }}>
                    {item.filename}
                  </div>
                  <div
                    className="row-between"
                    style={{ marginTop: 12, fontSize: 12.5, color: '#6b7f94' }}
                  >
                    <span>{formatBytes(item.sizeBytes)}</span>
                    <span>下载 {formatNumber(item.downloadCount)}</span>
                  </div>
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 26 }}>
              <Pagination
                current={data.page}
                pageSize={data.pageSize}
                total={data.total}
                showSizeChanger
                pageSizeOptions={[10, 20, 50]}
                showTotal={(total) => `共 ${total} 个安装包`}
                onChange={(nextPage, nextSize) =>
                  updateParams({ page: String(nextPage), size: String(nextSize) }, false)
                }
              />
            </div>
          </>
        ) : (
          <div className="panel empty-wrap">
            <Empty description="暂无软件包，请等待管理员发布" />
          </div>
        )}
      </div>

      <Drawer
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        width={640}
        title={selected ? `${selected.name}${selected.version ? ` · v${selected.version}` : ''}` : '软件包详情'}
      >
        {selected ? (
          <div className="stack">
            <div className="chip-row">
              <Tag color="blue" style={{ borderRadius: 999 }}>
                {selected.category}
              </Tag>
              {selected.platform ? (
                <Tag style={{ borderRadius: 999 }}>{selected.platform}</Tag>
              ) : null}
              <Tag style={{ borderRadius: 999 }}>
                {selected.source === 'scan' ? '目录扫描' : '手动上传'}
              </Tag>
            </div>

            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label="文件名" span={2}>
                <span style={{ wordBreak: 'break-all' }}>{selected.filename}</span>
              </Descriptions.Item>
              <Descriptions.Item label="大小">{formatBytes(selected.sizeBytes)}</Descriptions.Item>
              <Descriptions.Item label="下载量">
                {formatNumber(selected.downloadCount)}
              </Descriptions.Item>
              <Descriptions.Item label="更新时间" span={2}>
                {formatDate(selected.updatedAt)}
              </Descriptions.Item>
            </Descriptions>

            <Sha256 value={selected.sha256} length={32} />

            <DownloadButton
              resourceType="software"
              artifactId={selected.id}
              filename={selected.filename}
              label="下载安装包"
              block
            />

            <div>
              <div className="row-between" style={{ marginBottom: 10 }}>
                <strong style={{ fontSize: 14 }}>软件说明</strong>
              </div>
              {selected.descriptionMd ? (
                <MarkdownView content={selected.descriptionMd} />
              ) : (
                <div className="muted" style={{ fontSize: 13 }}>
                  暂无说明。管理员可在后台上传或编辑 markdown 说明文档。
                </div>
              )}
            </div>

            <CommentSection targetType="software" targetId={selected.id} title="软件包反馈" />
          </div>
        ) : null}
      </Drawer>
    </>
  );
}
