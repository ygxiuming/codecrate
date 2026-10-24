import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Pagination,
  Segmented,
  Select,
  Skeleton,
  Tag,
  Tooltip,
  Upload,
  message,
} from 'antd';
import {
  DownloadOutlined,
  FileOutlined,
  InboxOutlined,
  ReloadOutlined,
  SearchOutlined,
  TagsOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../api/client';
import type {
  PublicConfig,
  SoftwareCategory,
  SoftwareDetail,
  SoftwarePackage,
  SoftwareTag,
} from '../api/types';
import { CategoryTreeSelect } from '../components/CategoryTreeSelect';
import { CommentSection } from '../components/CommentSection';
import { DownloadButton } from '../components/DownloadButton';
import { MarkdownView } from '../components/MarkdownView';
import { Sha256 } from '../components/Sha256';
import { formatBytes, formatDate, formatNumber } from '../lib/format';
import { trackSearch } from '../lib/tracker';
import {
  SOFTWARE_PLATFORM_OPTIONS,
  buildCategoryTree,
  categoryColor,
  categoryIconGradient,
  categoryLastName,
  detectSoftwareMeta,
  nameInitial,
  splitCategoryPath,
  type CategoryNode,
} from '../lib/softwareMeta';

interface SoftwareListResponse {
  items: SoftwarePackage[];
  total: number;
  page: number;
  pageSize: number;
}

type PublicSortKey = 'updated' | 'downloads' | 'name';

const SORT_OPTIONS: Array<{ value: PublicSortKey; label: string }> = [
  { value: 'updated', label: '最新更新' },
  { value: 'downloads', label: '最多下载' },
  { value: 'name', label: '名称' },
];

const platformOptions = SOFTWARE_PLATFORM_OPTIONS.map((value) => ({ value, label: value }));

const SOURCE_LABELS: Record<string, string> = {
  scan: '目录扫描',
  upload: '手动上传',
  submission: '用户投稿',
};

function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

/** 图标优先展示本地上传的图片，加载失败时回退为分类色首字色块（两者都无需联网）。 */
function SoftwareIcon({
  name,
  category,
  iconUrl,
  large = false,
}: {
  name: string;
  category: string;
  iconUrl: string | null;
  large?: boolean;
}): JSX.Element {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(iconUrl) && !failed;
  return (
    <span
      className={`sw-icon${large ? ' sw-icon-lg' : ''}`}
      style={showImage ? { background: '#f2f6fb' } : { background: categoryIconGradient(category) }}
    >
      {showImage ? (
        <img src={iconUrl ?? ''} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        nameInitial(name)
      )}
    </span>
  );
}

function SoftwareCard({
  item,
  onOpen,
  onTagClick,
}: {
  item: SoftwarePackage;
  onOpen: () => void;
  onTagClick: (tag: string) => void;
}): JSX.Element {
  return (
    <button type="button" className="sw-card" onClick={onOpen}>
      <div className="sw-card-head">
        <SoftwareIcon name={item.name} category={item.category} iconUrl={item.iconUrl} />
        <span className="sw-card-title">
          <strong>{item.name}</strong>
          <span className="muted">
            {item.version ? `v${item.version}` : '版本未标注'}
            {item.platform ? ` · ${item.platform}` : ''}
          </span>
        </span>
        <Tooltip title={item.category}>
          <span className={`sw-cat sw-cat-${categoryColor(item.category)}`}>
            {categoryLastName(item.category)}
          </span>
        </Tooltip>
      </div>

      {item.tags.length > 0 ? (
        <div className="sw-tags">
          {item.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="sw-tag"
              role="button"
              tabIndex={0}
              onClick={(event) => {
                event.stopPropagation();
                onTagClick(tag);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.stopPropagation();
                  onTagClick(tag);
                }
              }}
            >
              {tag}
            </span>
          ))}
          {item.tags.length > 3 ? <span className="muted sw-tag-more">+{item.tags.length - 3}</span> : null}
        </div>
      ) : null}

      <div className="sw-file" title={item.filename}>
        <FileOutlined style={{ marginRight: 6 }} />
        {item.filename}
      </div>

      <div className="sw-foot">
        <span>{formatBytes(item.sizeBytes)}</span>
        <span className="sw-foot-downloads">
          <DownloadOutlined style={{ marginRight: 4 }} />
          {formatNumber(item.downloadCount)}
        </span>
      </div>
    </button>
  );
}

export function SoftwarePage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const category = params.get('category') ?? '';
  const tag = params.get('tag') ?? '';
  const sortParam = params.get('sort') ?? 'updated';
  const sort: PublicSortKey = (['updated', 'downloads', 'name'] as const).includes(
    sortParam as PublicSortKey,
  )
    ? (sortParam as PublicSortKey)
    : 'updated';
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);
  const pageSize = Math.min(50, Math.max(10, Number(params.get('size') ?? '12') || 12));

  const [keyword, setKeyword] = useState(q);
  const [data, setData] = useState<SoftwareListResponse | null>(null);
  const [categories, setCategories] = useState<SoftwareCategory[]>([]);
  const [hotTags, setHotTags] = useState<SoftwareTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SoftwareDetail | null>(null);
  const [submissionsEnabled, setSubmissionsEnabled] = useState(false);

  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitFile, setSubmitFile] = useState<File | null>(null);
  const [submitForm] = Form.useForm<{
    name?: string;
    version?: string;
    platform?: string;
    category?: string;
    tags?: string[];
    description_md?: string;
    note?: string;
  }>();

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
      .get<SoftwareListResponse>(`/api/public/software${qs({ q, category, tag, sort, page, pageSize })}`)
      .then(setData)
      .catch(() => setData({ items: [], total: 0, page: 1, pageSize }))
      .finally(() => setLoading(false));
  }, [q, category, tag, sort, page, pageSize]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api
      .get<PublicConfig>('/api/public/config')
      .then((config) => setSubmissionsEnabled(config.softwareSubmissionsEnabled !== false))
      .catch(() => setSubmissionsEnabled(false));
    api
      .get<{ items: SoftwareCategory[] }>('/api/public/software/categories')
      .then((result) => setCategories(result.items))
      .catch(() => setCategories([]));
    api
      .get<{ items: SoftwareTag[] }>('/api/public/software/tags')
      .then((result) => setHotTags(result.items))
      .catch(() => setHotTags([]));
  }, []);

  const categoryTree = useMemo(() => buildCategoryTree(categories), [categories]);

  // 多级分类导航：一级平铺；选中某级后，若其下还有子分类则追加展示下一级行
  const categoryRows = useMemo(() => {
    const rows: Array<{ base: string; nodes: CategoryNode[] }> = [];
    let current = categoryTree;
    let base = '';
    for (;;) {
      rows.push({ base, nodes: current });
      const hit = current.find(
        (node) => category === node.path || category.startsWith(`${node.path}/`),
      );
      if (!hit || hit.children.length === 0) break;
      current = hit.children;
      base = hit.path;
    }
    return rows;
  }, [categoryTree, category]);

  const submitSearch = (): void => {
    const value = keyword.trim();
    if (value) trackSearch(value);
    updateParams({ q: value || undefined });
  };

  const toggleTag = (value: string): void => {
    setSelected(null);
    updateParams({ tag: tag === value ? undefined : value });
  };

  const openDetail = (item: SoftwarePackage): void => {
    setSelected({ ...item, descriptionMd: '', verifiedAt: null, createdAt: item.updatedAt });
    api
      .get<SoftwareDetail>(`/api/public/software/${item.id}`)
      .then(setSelected)
      .catch(() => undefined);
  };

  const navigateCategory = (path: string): void => {
    setSelected(null);
    updateParams({ category: path || undefined });
  };

  const selectedCategorySegments = selected ? splitCategoryPath(selected.category) : [];

  const tagOptions = useMemo(
    () => hotTags.map((item) => ({ value: item.tag, label: item.tag })),
    [hotTags],
  );

  const submitSoftware = async (): Promise<void> => {
    if (!submitFile) {
      message.error('请先选择要投稿的安装包文件');
      return;
    }
    const values = await submitForm.validateFields();
    setSubmitting(true);
    try {
      await api.upload('/api/public/software/submit', submitFile, 'file', {
        name: values.name || undefined,
        version: values.version || undefined,
        platform: values.platform || undefined,
        category: values.category || undefined,
        tags: values.tags?.length ? JSON.stringify(values.tags) : undefined,
        description_md: values.description_md || undefined,
        note: values.note || undefined,
      });
      message.success('投稿已提交，管理员审核通过后会自动上架');
      setSubmitOpen(false);
      setSubmitFile(null);
      submitForm.resetFields();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="docs-hero">
        <div className="container">
          <h1>
            <InboxOutlined style={{ color: '#0078d4', marginRight: 10 }} />
            软件安装包
          </h1>
          <p>管理员发布的常用软件安装包，按多级分类与标签归档；附说明文档与 SHA256 校验值，可直接下载。也欢迎投稿推荐好用的软件。</p>
        </div>
      </div>

      <div className="container section">
        <div className="toolbar">
          <Input
            allowClear
            style={{ width: 280 }}
            prefix={<SearchOutlined style={{ color: '#7c93a9' }} />}
            placeholder="搜索软件名、版本、标签或说明"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onPressEnter={submitSearch}
          />
          <Button type="primary" onClick={submitSearch}>
            搜索
          </Button>
          <Segmented<PublicSortKey>
            value={sort}
            options={SORT_OPTIONS}
            onChange={(value) => updateParams({ sort: value === 'updated' ? undefined : value })}
          />
          <Button icon={<ReloadOutlined />} onClick={load}>
            刷新
          </Button>
          {submissionsEnabled ? (
            <Button icon={<UploadOutlined />} onClick={() => setSubmitOpen(true)}>
              投稿软件
            </Button>
          ) : null}
          <span style={{ marginLeft: 'auto', color: '#6b7f94', fontSize: 12.5 }}>
            共 {formatNumber(data?.total ?? 0)} 个安装包
          </span>
        </div>

        {categoryRows.length > 0 ? (
          <div className="sw-nav">
            {categoryRows.map((row, rowIndex) => (
              <div className="sw-nav-row" key={rowIndex}>
                {rowIndex > 0 ? <span className="sw-nav-label">子分类</span> : null}
                <Tag.CheckableTag
                  checked={category === row.base}
                  onChange={() => navigateCategory(row.base)}
                >
                  全部
                </Tag.CheckableTag>
                {row.nodes.map((node) => (
                  <Tag.CheckableTag
                    key={node.path}
                    checked={category === node.path}
                    onChange={(checked) => navigateCategory(checked ? node.path : '')}
                  >
                    {node.name}
                    <span className="sw-nav-count">{node.total}</span>
                  </Tag.CheckableTag>
                ))}
              </div>
            ))}
          </div>
        ) : null}

        {hotTags.length > 0 ? (
          <div className="sw-nav">
            <div className="sw-nav-row">
              <span className="sw-nav-label">
                <TagsOutlined style={{ marginRight: 4 }} />
                标签
              </span>
              {tag ? (
                <Tag.CheckableTag checked onChange={() => toggleTag(tag)}>
                  {tag}
                  <span className="sw-nav-count">
                    {hotTags.find((item) => item.tag === tag)?.count ?? ''}
                  </span>
                </Tag.CheckableTag>
              ) : null}
              {hotTags
                .filter((item) => item.tag !== tag)
                .slice(0, 14)
                .map((item) => (
                  <Tag.CheckableTag key={item.tag} checked={false} onChange={() => toggleTag(item.tag)}>
                    {item.tag}
                    <span className="sw-nav-count">{item.count}</span>
                  </Tag.CheckableTag>
                ))}
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className="sw-grid">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="panel">
                <Skeleton active paragraph={{ rows: 3 }} />
              </div>
            ))}
          </div>
        ) : data && data.items.length > 0 ? (
          <>
            <div className="sw-grid">
              {data.items.map((item) => (
                <SoftwareCard
                  key={item.id}
                  item={item}
                  onOpen={() => openDetail(item)}
                  onTagClick={toggleTag}
                />
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 26 }}>
              <Pagination
                current={data.page}
                pageSize={data.pageSize}
                total={data.total}
                showSizeChanger
                pageSizeOptions={[12, 24, 48]}
                showTotal={(total) => `共 ${total} 个安装包`}
                onChange={(nextPage, nextSize) =>
                  updateParams({ page: String(nextPage), size: String(nextSize) }, false)
                }
              />
            </div>
          </>
        ) : (
          <div className="panel empty-wrap">
            <Empty
              description={
                q || category || tag
                  ? '没有符合当前筛选条件的软件包，试试更换关键词或分类'
                  : '暂无软件包，请等待管理员发布'
              }
            />
            {q || category || tag ? (
              <Button
                type="link"
                onClick={() => updateParams({ q: undefined, category: undefined, tag: undefined })}
              >
                清除全部筛选
              </Button>
            ) : null}
          </div>
        )}
      </div>

      <Drawer
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        width={660}
        title={
          selected ? (
            <div className="sw-drawer-title">
              <SoftwareIcon
                name={selected.name}
                category={selected.category}
                iconUrl={selected.iconUrl}
                large
              />
              <span>
                <div className="sw-drawer-name">
                  {selected.name}
                  {selected.version ? <em>v{selected.version}</em> : null}
                </div>
                <div className="sw-drawer-crumb">
                  {selectedCategorySegments.map((segment, index) => (
                    <span key={index}>
                      {index > 0 ? <i>/</i> : null}
                      {segment}
                    </span>
                  ))}
                </div>
              </span>
            </div>
          ) : (
            '软件包详情'
          )
        }
      >
        {selected ? (
          <div className="stack">
            {selected.tags.length > 0 ? (
              <div className="sw-tags">
                {selected.tags.map((item) => (
                  <span
                    key={item}
                    className={`sw-tag${tag === item ? ' sw-tag-active' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleTag(item)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') toggleTag(item);
                    }}
                  >
                    {item}
                  </span>
                ))}
              </div>
            ) : null}

            <div className="sw-meta-grid">
              <div className="sw-meta-item">
                <span className="sw-meta-label">分类</span>
                <span>
                  <Tag color={categoryColor(selected.category)} style={{ borderRadius: 999 }}>
                    {categoryLastName(selected.category)}
                  </Tag>
                </span>
              </div>
              <div className="sw-meta-item">
                <span className="sw-meta-label">平台</span>
                <span>{selected.platform || '未标注'}</span>
              </div>
              <div className="sw-meta-item">
                <span className="sw-meta-label">文件大小</span>
                <span>{formatBytes(selected.sizeBytes)}</span>
              </div>
              <div className="sw-meta-item">
                <span className="sw-meta-label">下载次数</span>
                <span>{formatNumber(selected.downloadCount)}</span>
              </div>
              <div className="sw-meta-item">
                <span className="sw-meta-label">来源</span>
                <span>{sourceLabel(selected.source)}</span>
              </div>
              <div className="sw-meta-item">
                <span className="sw-meta-label">更新时间</span>
                <span>{formatDate(selected.updatedAt)}</span>
              </div>
              <div className="sw-meta-item sw-meta-wide">
                <span className="sw-meta-label">文件名</span>
                <span className="sw-meta-file">{selected.filename}</span>
              </div>
            </div>

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

      <Modal
        open={submitOpen}
        title="投稿软件"
        width={640}
        okText="提交审核"
        cancelText="取消"
        confirmLoading={submitting}
        onOk={() => void submitSoftware()}
        onCancel={() => {
          setSubmitOpen(false);
          setSubmitFile(null);
          submitForm.resetFields();
        }}
      >
        <div className="stack" style={{ gap: 12 }}>
          <Alert
            type="info"
            showIcon
            message="投稿会先进入管理员审核队列；审核通过后自动合并到软件包并对外展示。"
          />
          <Upload.Dragger
            multiple={false}
            showUploadList
            maxCount={1}
            disabled={submitting}
            beforeUpload={(file) => {
              setSubmitFile(file);
              const detected = detectSoftwareMeta(file.name);
              submitForm.setFieldsValue({
                ...(detected.name ? { name: detected.name } : {}),
                ...(detected.version ? { version: detected.version } : {}),
                ...(detected.platform ? { platform: detected.platform } : {}),
              });
              return false;
            }}
            onRemove={() => {
              setSubmitFile(null);
            }}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">选择要投稿的安装包文件</p>
            <p className="ant-upload-hint">文件名会自动识别软件名称、版本与平台，可手动修改</p>
          </Upload.Dragger>
          <Form form={submitForm} layout="vertical">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Form.Item
                label="软件名称"
                name="name"
                rules={[{ required: true, message: '请输入软件名称' }]}
              >
                <Input placeholder="选择文件后自动识别" />
              </Form.Item>
              <Form.Item label="版本" name="version">
                <Input placeholder="例如 2.1.0" />
              </Form.Item>
              <Form.Item label="平台/架构" name="platform">
                <Select options={platformOptions} placeholder="选择目标平台" allowClear showSearch />
              </Form.Item>
              <Form.Item label="分类" name="category">
                <CategoryTreeSelect categories={categories} placeholder="选择分类（可选）" />
              </Form.Item>
            </div>
            <Form.Item label="标签" name="tags">
              <Select
                mode="tags"
                allowClear
                tokenSeparators={[',', '，', '、', ';']}
                options={tagOptions}
                placeholder="如：内网常用、免安装"
              />
            </Form.Item>
            <Form.Item label="软件简介（Markdown，可选）" name="description_md">
              <Input.TextArea rows={4} placeholder="软件用途、安装步骤、注意事项…" />
            </Form.Item>
            <Form.Item label="给管理员的备注（可选）" name="note">
              <Input maxLength={500} placeholder="例如：来源、推荐理由、注意事项" />
            </Form.Item>
          </Form>
        </div>
      </Modal>
    </>
  );
}
