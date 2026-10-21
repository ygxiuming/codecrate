import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Divider,
  Input,
  Modal,
  Pagination,
  Segmented,
  Select,
  Skeleton,
  Table,
  Tag,
  Tooltip,
  message,
} from 'antd';
import { DownloadOutlined, ReloadOutlined, SearchOutlined, ShopOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api, qs } from '../../api/client';
import type {
  MarketplaceDetail,
  MarketplaceSearchResponse,
  MarketplaceSummary,
} from '../../api/types';
import { formatDate, formatNumber, platformLabel } from '../../lib/format';

interface CacheState {
  item: MarketplaceSummary;
  detail?: MarketplaceDetail;
  loading: boolean;
  version?: string;
  platform: string;
}

export function MarketplacePage() {
  const navigate = useNavigate();
  const [provider, setProvider] = useState('official');
  const [keyword, setKeyword] = useState('');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string | undefined>();
  const [sort, setSort] = useState('downloads');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<MarketplaceSearchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [cacheState, setCacheState] = useState<CacheState | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get<MarketplaceSearchResponse>(
        `/api/admin/marketplace/search${qs({
          provider,
          q,
          category,
          sort,
          page,
          pageSize: 20,
        })}`,
      )
      .then(setData)
      .catch((error) => {
        message.error((error as Error).message);
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [provider, q, category, sort, page]);

  useEffect(() => {
    load();
  }, [load]);

  const openCache = async (item: MarketplaceSummary): Promise<void> => {
    setCacheState({ item, loading: true, platform: 'auto' });
    try {
      const result = await api.get<{ detail: MarketplaceDetail }>(
        `/api/admin/marketplace/extension${qs({ provider, id: item.id })}`,
      );
      setCacheState({
        item,
        detail: result.detail,
        loading: false,
        version: result.detail.version,
        platform: 'auto',
      });
    } catch (error) {
      message.error((error as Error).message);
      setCacheState(null);
    }
  };

  const versions = cacheState?.detail
    ? Array.from(new Set(cacheState.detail.versions.map((item) => item.version)))
    : [];
  const variants =
    cacheState?.detail?.versions.filter((item) => item.version === cacheState.version) ?? [];
  const selectedVariant =
    variants.find((item) => (item.targetPlatform || 'universal') === cacheState?.platform) ??
    variants.find((item) => !item.targetPlatform);

  const confirmCache = async (): Promise<void> => {
    if (!cacheState || !cacheState.version) return;
    setSubmitting(true);
    try {
      const targetPlatform =
        cacheState.platform === 'auto'
          ? undefined
          : cacheState.platform === 'universal'
            ? ''
            : cacheState.platform;
      const result = await api.post<{ taskId: number }>('/api/admin/marketplace/cache', {
        provider,
        id: cacheState.item.id,
        version: cacheState.version,
        targetPlatform,
      });
      message.success(`已创建缓存任务 #${result.taskId}`);
      setCacheState(null);
      navigate('/admin/tasks');
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="stack">
      <div className="page-title">
        <h2>市场浏览</h2>
        <p>联网状态下检索插件市场并一键缓存。官方源覆盖最全，Open VSX 更开放，可按合规要求切换。</p>
      </div>

      {provider === 'official' ? (
        <Alert
          type="warning"
          showIcon
          message="官方 Marketplace 合规提示"
          description="官方 gallery 接口主要面向 VS Code 客户端，第三方使用可能存在服务条款限制。对合规敏感的环境请切换 Open VSX，或仅使用手工上传的 vsix。"
          style={{ borderRadius: 12 }}
        />
      ) : null}

      <div className="panel">
        <div className="toolbar-inline" style={{ marginBottom: 14 }}>
          <Segmented
            value={provider}
            options={[
              { value: 'official', label: '官方 Marketplace' },
              { value: 'openvsx', label: 'Open VSX' },
            ]}
            onChange={(value) => {
              setProvider(String(value));
              setPage(1);
            }}
          />
          <Input
            allowClear
            style={{ width: 260 }}
            prefix={<SearchOutlined style={{ color: '#7c93a9' }} />}
            placeholder="搜索插件名称或关键词"
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
          <Select
            allowClear
            style={{ width: 200 }}
            placeholder="全部分类"
            value={category}
            options={(data?.categories ?? []).map((item) => ({ value: item, label: item }))}
            onChange={(value) => {
              setCategory(value);
              setPage(1);
            }}
          />
          <Select
            style={{ width: 150 }}
            value={sort}
            options={[
              { value: 'downloads', label: '按下载量' },
              { value: 'updated', label: '按更新时间' },
              { value: 'relevance', label: '按相关性' },
            ]}
            onChange={(value) => {
              setSort(value);
              setPage(1);
            }}
          />
          <Button icon={<ReloadOutlined />} onClick={load}>
            刷新
          </Button>
        </div>

        <Table<MarketplaceSummary>
          rowKey="id"
          size="middle"
          loading={loading}
          dataSource={data?.items ?? []}
          pagination={false}
          scroll={{ x: 980 }}
          columns={[
            {
              title: '插件',
              key: 'name',
              width: 300,
              render: (_, row) => (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <div className="ext-icon" style={{ width: 38, height: 38, fontSize: 15, borderRadius: 9 }}>
                    {(row.displayName || row.name).slice(0, 1).toUpperCase()}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.displayName}
                    </div>
                    <div className="muted mono" style={{ fontSize: 11.5 }}>
                      {row.id}
                    </div>
                  </div>
                </div>
              ),
            },
            { title: '版本', dataIndex: 'version', width: 150, render: (value: string) => <span className="mono">{value}</span> },
            { title: '引擎', dataIndex: 'engineRange', width: 120, render: (value?: string) => value ?? '—' },
            {
              title: '下载量',
              dataIndex: 'downloadCount',
              width: 110,
              render: (value: number) => formatNumber(value),
            },
            {
              title: '更新时间',
              dataIndex: 'updatedAt',
              width: 150,
              render: (value?: string) => (
                <span className="muted" style={{ fontSize: 12 }}>
                  {formatDate(value, 'YYYY-MM-DD')}
                </span>
              ),
            },
            {
              title: '状态',
              key: 'cached',
              width: 150,
              render: (_, row) =>
                row.cached ? (
                  <Tooltip title={(row.cachedVersions ?? []).join(', ')}>
                    <Tag color="green" style={{ borderRadius: 999 }}>
                      已缓存 {row.cachedVersions?.length ?? 0} 个版本
                    </Tag>
                  </Tooltip>
                ) : (
                  <Tag style={{ borderRadius: 999 }}>未缓存</Tag>
                ),
            },
            {
              title: '操作',
              key: 'action',
              width: 110,
              fixed: 'right',
              render: (_, row) => (
                <Button
                  size="small"
                  type="primary"
                  ghost
                  icon={<DownloadOutlined />}
                  onClick={() => void openCache(row)}
                >
                  缓存
                </Button>
              ),
            },
          ]}
          locale={{ emptyText: '没有搜索结果' }}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <Pagination
            current={page}
            pageSize={20}
            total={data?.total ?? 0}
            showTotal={(total) => `共 ${formatNumber(total)} 个插件`}
            onChange={(nextPage) => setPage(nextPage)}
          />
        </div>
      </div>

      <Modal
        open={Boolean(cacheState)}
        title={
          cacheState ? (
            <span>
              <ShopOutlined /> 缓存插件 · {cacheState.item.displayName}
            </span>
          ) : (
            '缓存插件'
          )
        }
        onCancel={() => setCacheState(null)}
        okText="创建缓存任务"
        cancelText="取消"
        confirmLoading={submitting}
        onOk={() => void confirmCache()}
        width={620}
      >
        {cacheState?.loading ? (
          <Skeleton active paragraph={{ rows: 5 }} />
        ) : cacheState?.detail ? (
          <div className="stack">
            <div className="muted" style={{ fontSize: 12.5 }}>
              {cacheState.detail.id} · Publisher {cacheState.detail.publisher}
            </div>
            <p style={{ margin: 0, lineHeight: 1.8, color: '#425466' }}>
              {cacheState.detail.description || '暂无描述'}
            </p>
            <Divider style={{ margin: '4px 0' }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>选择版本</div>
              <Select
                style={{ width: '100%' }}
                showSearch
                optionFilterProp="label"
                value={cacheState.version}
                options={versions.map((version) => ({ value: version, label: version }))}
                onChange={(version) => setCacheState({ ...cacheState, version, platform: 'auto' })}
              />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>目标平台</div>
              <Select
                style={{ width: '100%' }}
                value={cacheState.platform}
                onChange={(platform) => setCacheState({ ...cacheState, platform })}
                options={[
                  { value: 'auto', label: '自动（优先通用包，否则 linux-x64）' },
                  ...variants.map((variant) => ({
                    value: variant.targetPlatform || 'universal',
                    label: platformLabel(variant.targetPlatform || 'universal'),
                  })),
                ]}
              />
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                插件若包含原生二进制，需选择与目标机器匹配的平台包；纯 JS 插件使用通用包即可。
              </div>
            </div>
            {selectedVariant ? (
              <div className="panel panel-tight" style={{ boxShadow: 'none', background: '#f8fbff' }}>
                <div style={{ fontSize: 12.5, color: '#425466', lineHeight: 1.9 }}>
                  <div>引擎要求：{selectedVariant.engineRange ?? '未声明'}</div>
                  <div>
                    依赖：{selectedVariant.dependencies.length ? selectedVariant.dependencies.join(', ') : '无'}
                  </div>
                  <div>
                    Extension Pack：
                    {selectedVariant.extensionPack.length ? selectedVariant.extensionPack.join(', ') : '无'}
                  </div>
                  <div>更新时间：{formatDate(selectedVariant.updatedAt)}</div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
