import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Pagination,
  Popconfirm,
  Select,
  Skeleton,
  Space,
  Table,
  Tag,
  Tooltip,
  Upload,
  message,
} from 'antd';
import {
  AppstoreOutlined,
  AuditOutlined,
  CloudSyncOutlined,
  DatabaseOutlined,
  DownloadOutlined,
  InboxOutlined,
  PictureOutlined,
  ReloadOutlined,
  SearchOutlined,
  SwapOutlined,
  TagsOutlined,
} from '@ant-design/icons';
import { api, qs } from '../../api/client';
import type {
  AdminSoftwareCategory,
  AdminSoftwareRow,
  AdminSoftwareSummary,
  SoftwareBatchAction,
  SoftwareScanResult,
  SoftwareSortKey,
  SoftwareSubmission,
  SubmissionStatus,
} from '../../api/types';
import { CategoryTreeSelect } from '../../components/CategoryTreeSelect';
import { DownloadButton } from '../../components/DownloadButton';
import { MarkdownView } from '../../components/MarkdownView';
import { Sha256 } from '../../components/Sha256';
import { StatCard } from '../../components/StatCard';
import { formatBytes, formatDate, formatNumber } from '../../lib/format';
import {
  SOFTWARE_PLATFORM_OPTIONS,
  categoryColor,
  categoryLastName,
  categoryParentPath,
  detectSoftwareMeta,
  nameInitial,
} from '../../lib/softwareMeta';
import { showUploadDuplicateModal } from '../../lib/uploadErrors';

const { TextArea } = Input;

const platformOptions = SOFTWARE_PLATFORM_OPTIONS.map((value) => ({ value, label: value }));

const SOURCE_TAGS: Record<string, { color: string; label: string }> = {
  scan: { color: 'blue', label: '扫描' },
  upload: { color: 'green', label: '上传' },
  submission: { color: 'cyan', label: '投稿' },
};

const sortOptions: Array<{ value: SoftwareSortKey; label: string }> = [
  { value: 'updated', label: '最新更新' },
  { value: 'downloads', label: '最多下载' },
  { value: 'size', label: '体积最大' },
  { value: 'name', label: '名称' },
];

interface PackageFormValues {
  name?: string;
  version?: string;
  platform?: string;
  category?: string;
  tags?: string[];
  description_md?: string;
}

function CategoryCell({ value }: { value: string }): JSX.Element {
  const parent = categoryParentPath(value);
  const last = categoryLastName(value);
  const tag = <Tag color={categoryColor(value)}>{last}</Tag>;
  return (
    <Tooltip title={value}>
      <span className="cat-cell">
        {parent ? (
          <span className="muted cat-parent">{parent}/</span>
        ) : null}
        {tag}
      </span>
    </Tooltip>
  );
}

function TagsCell({ tags }: { tags: string[] }): JSX.Element {
  if (!tags.length) return <span className="muted">—</span>;
  return (
    <Tooltip title={tags.join(' · ')}>
      <span className="tag-cell">
        {tags.slice(0, 2).map((tag) => (
          <Tag key={tag}>{tag}</Tag>
        ))}
        {tags.length > 2 ? <span className="muted">+{tags.length - 2}</span> : null}
      </span>
    </Tooltip>
  );
}

export function SoftwareAdminPage() {
  const [data, setData] = useState<{
    items: AdminSoftwareRow[];
    total: number;
    page: number;
    pageSize: number;
  } | null>(null);
  const [categories, setCategories] = useState<AdminSoftwareCategory[]>([]);
  const [summary, setSummary] = useState<AdminSoftwareSummary | null>(null);
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [q, setQ] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [sort, setSort] = useState<SoftwareSortKey>('updated');
  const [page, setPage] = useState(1);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadIconFile, setUploadIconFile] = useState<File | null>(null);
  const [uploadForm] = Form.useForm<PackageFormValues>();
  const [preview, setPreview] = useState(false);

  const [editing, setEditing] = useState<AdminSoftwareRow | null>(null);
  const [editForm] = Form.useForm<PackageFormValues>();
  const [saving, setSaving] = useState(false);
  const [editIconFile, setEditIconFile] = useState<File | null>(null);
  const [iconBusy, setIconBusy] = useState(false);

  const [submissionsOpen, setSubmissionsOpen] = useState(false);
  const [submissions, setSubmissions] = useState<SoftwareSubmission[]>([]);
  const [submissionsTotal, setSubmissionsTotal] = useState(0);
  const [submissionsStatus, setSubmissionsStatus] = useState<SubmissionStatus>('pending');
  const [submissionsLoading, setSubmissionsLoading] = useState(false);
  const [reviewing, setReviewing] = useState<SoftwareSubmission | null>(null);
  const [reviewForm] = Form.useForm<{ category?: string; tags?: string[]; note?: string; comment?: string }>();
  const [reviewBusy, setReviewBusy] = useState(false);

  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<SoftwareScanResult | null>(null);

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameForm] = Form.useForm<{ from: string; to: string }>();

  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchCategoryOpen, setBatchCategoryOpen] = useState(false);
  const [batchCategoryForm] = Form.useForm<{ category: string }>();
  const [batchTagMode, setBatchTagMode] = useState<'add' | 'remove' | null>(null);
  const [batchTagForm] = Form.useForm<{ tags: string[] }>();

  const load = useCallback(() => {
    setLoading(true);
    api
      .get<{
        items: AdminSoftwareRow[];
        total: number;
        page: number;
        pageSize: number;
      }>(`/api/admin/software${qs({ page, pageSize: 20, q, category: categoryFilter || undefined, sort })}`)
      .then(setData)
      .catch((error) => message.error((error as Error).message))
      .finally(() => setLoading(false));
  }, [page, q, categoryFilter, sort]);

  const loadMeta = useCallback(() => {
    api
      .get<{ items: AdminSoftwareCategory[] }>('/api/admin/software/categories')
      .then((result) => setCategories(result.items))
      .catch(() => undefined);
    api
      .get<{ items: Array<{ tag: string; count: number }> }>('/api/admin/software/tags')
      .then((result) => setTagSuggestions(result.items.map((item) => item.tag)))
      .catch(() => undefined);
    api
      .get<AdminSoftwareSummary>('/api/admin/software/summary')
      .then(setSummary)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  const refreshAll = (): void => {
    load();
    loadMeta();
  };

  const tagOptions = useMemo(
    () => tagSuggestions.map((tag) => ({ value: tag, label: tag })),
    [tagSuggestions],
  );

  const renderTagSelect = (placeholder: string): JSX.Element => (
    <Select
      mode="tags"
      allowClear
      tokenSeparators={[',', '，', '、', ';']}
      placeholder={placeholder}
      options={tagOptions}
    />
  );

  const handleUpload = async (): Promise<void> => {
    if (!uploadFile) {
      message.error('请先选择安装包文件');
      return;
    }
    const values = await uploadForm.validateFields();
    setUploading(true);
    try {
      const result = await api.uploadFiles<{ id: number; name: string }>(
        '/api/admin/software/upload',
        [
          { field: 'file', file: uploadFile },
          ...(uploadIconFile ? [{ field: 'icon', file: uploadIconFile }] : []),
        ],
        {
          name: values.name || undefined,
          version: values.version || undefined,
          platform: values.platform || undefined,
          category: values.category || undefined,
          tags: values.tags?.length ? JSON.stringify(values.tags) : undefined,
          description_md: values.description_md || undefined,
        },
      );
      message.success(`软件包「${result.name}」已发布`);
      setUploadOpen(false);
      setUploadFile(null);
      setUploadIconFile(null);
      uploadForm.resetFields();
      refreshAll();
    } catch (error) {
      showUploadDuplicateModal(error);
    } finally {
      setUploading(false);
    }
  };

  const openEdit = (row: AdminSoftwareRow): void => {
    setEditing(row);
    setPreview(false);
    api
      .get<AdminSoftwareRow & { description_md: string }>(`/api/admin/software/${row.id}`)
      .then((detail) => {
        editForm.setFieldsValue({
          name: detail.name,
          version: detail.version,
          platform: detail.platform,
          category: detail.category,
          tags: detail.tags,
          description_md: detail.description_md,
        });
      })
      .catch((error) => message.error((error as Error).message));
  };

  const saveEdit = async (): Promise<void> => {
    if (!editing) return;
    const values = await editForm.validateFields();
    setSaving(true);
    try {
      await api.put(`/api/admin/software/${editing.id}`, {
        ...values,
        tags: values.tags ?? [],
      });
      message.success('已保存');
      setEditing(null);
      refreshAll();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const scan = async (): Promise<void> => {
    setScanning(true);
    try {
      const result = await api.post<SoftwareScanResult>('/api/admin/software/scan');
      setScanResult(result);
      message.success(
        `扫描完成：新增 ${result.added}，更新 ${result.updated}，移除 ${result.removed}，跳过 ${result.skipped}`,
      );
      refreshAll();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setScanning(false);
    }
  };

  const remove = async (id: number): Promise<void> => {
    try {
      await api.del(`/api/admin/software/${id}`);
      message.success('已删除软件包');
      refreshAll();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const renameCategory = async (): Promise<void> => {
    const values = await renameForm.validateFields();
    try {
      const result = await api.post<{ changed: number }>('/api/admin/software/category-rename', values);
      message.success(`已更新 ${result.changed} 个软件包的分类`);
      setRenameOpen(false);
      renameForm.resetFields();
      refreshAll();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const runBatch = async (
    action: SoftwareBatchAction,
    payload: Record<string, unknown> = {},
  ): Promise<void> => {
    if (!selectedIds.length) return;
    setBatchBusy(true);
    try {
      const result = await api.post<{ changed: number }>('/api/admin/software/batch', {
        action,
        ids: selectedIds,
        ...payload,
      });
      message.success(`已处理 ${result.changed} 个软件包`);
      setSelectedIds([]);
      setBatchCategoryOpen(false);
      setBatchTagMode(null);
      batchCategoryForm.resetFields();
      batchTagForm.resetFields();
      refreshAll();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBatchBusy(false);
    }
  };

  const submitBatchCategory = async (): Promise<void> => {
    const values = await batchCategoryForm.validateFields();
    await runBatch('set_category', { category: values.category });
  };

  const submitBatchTags = async (): Promise<void> => {
    const values = await batchTagForm.validateFields();
    if (!batchTagMode) return;
    await runBatch(batchTagMode === 'add' ? 'add_tags' : 'remove_tags', { tags: values.tags });
  };

  const loadSubmissions = useCallback((status: SubmissionStatus) => {
    setSubmissionsLoading(true);
    api
      .get<{ items: SoftwareSubmission[]; total: number }>(
        `/api/admin/software/submissions${qs({ status, pageSize: 50 })}`,
      )
      .then((result) => {
        setSubmissions(result.items);
        setSubmissionsTotal(result.total);
      })
      .catch((error) => message.error((error as Error).message))
      .finally(() => setSubmissionsLoading(false));
  }, []);

  const openSubmissions = (status: SubmissionStatus): void => {
    setSubmissionsStatus(status);
    setSubmissionsOpen(true);
    loadSubmissions(status);
  };

  const openReview = (row: SoftwareSubmission): void => {
    setReviewing(row);
    reviewForm.setFieldsValue({
      category: row.category || undefined,
      tags: row.tags,
      note: row.note || undefined,
    });
  };

  const approveReview = async (): Promise<void> => {
    if (!reviewing) return;
    const values = await reviewForm.validateFields();
    setReviewBusy(true);
    try {
      const result = await api.post<{ packageId: number; name: string }>(
        `/api/admin/software/submissions/${reviewing.id}/approve`,
        {
          category: values.category || undefined,
          tags: values.tags?.length ? values.tags : undefined,
          note: values.note || undefined,
        },
      );
      message.success(`已通过并上架「${result.name}」`);
      setReviewing(null);
      loadSubmissions(submissionsStatus);
      refreshAll();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setReviewBusy(false);
    }
  };

  const rejectReview = async (): Promise<void> => {
    if (!reviewing) return;
    const values = await reviewForm.validateFields().catch(() => ({ comment: '' }));
    setReviewBusy(true);
    try {
      await api.post(`/api/admin/software/submissions/${reviewing.id}/reject`, {
        comment: values.comment || undefined,
      });
      message.success('已拒绝该投稿');
      setReviewing(null);
      loadSubmissions(submissionsStatus);
      loadMeta();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setReviewBusy(false);
    }
  };

  const removeSubmission = async (id: number): Promise<void> => {
    try {
      await api.del(`/api/admin/software/submissions/${id}`);
      message.success('已删除投稿记录');
      loadSubmissions(submissionsStatus);
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const replaceIcon = async (): Promise<void> => {
    if (!editing || !editIconFile) {
      message.warning('请先选择新图标文件');
      return;
    }
    setIconBusy(true);
    try {
      const result = await api.upload<{ iconUrl: string | null }>(
        `/api/admin/software/${editing.id}/icon`,
        editIconFile,
        'icon',
      );
      message.success('图标已更新');
      setEditIconFile(null);
      setEditing({ ...editing, iconUrl: result.iconUrl });
      load();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setIconBusy(false);
    }
  };

  const removeIcon = async (): Promise<void> => {
    if (!editing) return;
    setIconBusy(true);
    try {
      await api.del(`/api/admin/software/${editing.id}/icon`);
      message.success('已恢复默认色块图标');
      setEditing({ ...editing, iconUrl: null });
      load();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setIconBusy(false);
    }
  };

  const editMarkdown = Form.useWatch('description_md', editForm) ?? '';
  const uploadMarkdown = Form.useWatch('description_md', uploadForm) ?? '';

  return (
    <div className="stack">
      <div className="page-title">
        <h2>软件包管理</h2>
        <p>
          发布任意软件安装包：手动上传并填写说明（支持 Markdown），或将文件放到
          <code> data/files/software/&lt;分类&gt;/&lt;软件名&gt;/&lt;版本&gt;/</code> 目录后自动扫描。
          分类支持「开发工具/IDE」这样的多级路径，还可为软件包打上自由标签，两者都可在前台直接筛选。
        </p>
      </div>

      {summary ? (
        <div className="stat-grid">
          <StatCard label="软件包" value={formatNumber(summary.total)} icon={<AppstoreOutlined />} foot={`${summary.categories} 个分类`} />
          <StatCard label="累计下载" value={formatNumber(summary.downloads)} icon={<DownloadOutlined />} foot="全部软件包合计" />
          <StatCard label="存储占用" value={formatBytes(summary.bytes)} icon={<DatabaseOutlined />} foot="安装包文件总体积" />
          <StatCard label="标签" value={formatNumber(summary.tags)} icon={<TagsOutlined />} foot="去重后的标签总数" />
        </div>
      ) : null}

      <div className="panel">
        <Space wrap style={{ marginBottom: 14 }}>
          <Button type="primary" icon={<InboxOutlined />} onClick={() => setUploadOpen(true)}>
            上传软件包
          </Button>
          <Button icon={<CloudSyncOutlined />} loading={scanning} onClick={() => void scan()}>
            立即扫描目录
          </Button>
          <Button icon={<SwapOutlined />} onClick={() => setRenameOpen(true)}>
            分类重命名
          </Button>
          <Badge count={summary?.pendingSubmissions ?? 0} size="small" offset={[-2, 2]}>
            <Button icon={<AuditOutlined />} onClick={() => openSubmissions('pending')}>
              审核投稿
            </Button>
          </Badge>
        </Space>

        {scanResult ? (
          <Alert
            type="success"
            showIcon
            closable
            style={{ marginBottom: 14 }}
            message={`扫描完成（${(scanResult.durationMs / 1000).toFixed(1)}s）`}
            description={`共扫描 ${scanResult.scannedFiles} 个文件：新增 ${scanResult.added} · 更新 ${scanResult.updated} · 移除 ${scanResult.removed} · 跳过 ${scanResult.skipped}${scanResult.errors.length ? ` · ${scanResult.errors.length} 个错误：${scanResult.errors[0]}` : ''}`}
          />
        ) : null}

        <div className="toolbar-inline" style={{ marginBottom: 14 }}>
          <Input
            allowClear
            style={{ width: 240 }}
            prefix={<SearchOutlined style={{ color: '#7c93a9' }} />}
            placeholder="搜索软件名、版本、标签"
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
          <div style={{ width: 220 }}>
            <CategoryTreeSelect
              value={categoryFilter}
              onChange={(value) => {
                setPage(1);
                setCategoryFilter(value);
              }}
              categories={categories}
              allowCreate={false}
              showCount
              placeholder="全部分类"
            />
          </div>
          <Select<SoftwareSortKey>
            style={{ width: 130 }}
            value={sort}
            options={sortOptions}
            onChange={(value) => {
              setPage(1);
              setSort(value);
            }}
          />
          <Button icon={<ReloadOutlined />} onClick={load}>
            刷新
          </Button>
          <span className="muted" style={{ marginLeft: 'auto' }}>
            共 {formatNumber(data?.total ?? 0)} 条记录
          </span>
        </div>

        {selectedIds.length > 0 ? (
          <div className="batch-bar">
            <span>
              已选择 <strong>{selectedIds.length}</strong> 项
            </span>
            <Button size="small" onClick={() => setBatchCategoryOpen(true)}>
              批量设置分类
            </Button>
            <Button size="small" onClick={() => setBatchTagMode('add')}>
              批量添加标签
            </Button>
            <Button size="small" onClick={() => setBatchTagMode('remove')}>
              批量移除标签
            </Button>
            <Popconfirm
              title={`删除选中的 ${selectedIds.length} 个软件包？`}
              description="会同时删除文件本身，且不可恢复。"
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => void runBatch('delete')}
            >
              <Button size="small" danger loading={batchBusy}>
                批量删除
              </Button>
            </Popconfirm>
            <Button size="small" type="text" onClick={() => setSelectedIds([])}>
              取消选择
            </Button>
          </div>
        ) : null}

        <Table<AdminSoftwareRow>
          rowKey="id"
          size="middle"
          loading={loading}
          dataSource={data?.items ?? []}
          pagination={false}
          rowSelection={{
            selectedRowKeys: selectedIds,
            onChange: (keys) => setSelectedIds(keys.map((key) => Number(key))),
          }}
          expandable={{
            expandedRowRender: (row) => (
              <Space wrap size={16} style={{ fontSize: 12.5 }}>
                <span>
                  <span className="muted">SHA256：</span>
                  <Sha256 value={row.sha256} />
                </span>
                <span>
                  <span className="muted">存储路径：</span>
                  <code style={{ fontSize: 12 }}>{row.filename}</code>
                </span>
              </Space>
            ),
            rowExpandable: () => true,
          }}
          columns={[
            {
              title: '软件',
              key: 'name',
              render: (_, row) => (
                <div className="sw-admin-name">
                  {row.iconUrl ? (
                    <img className="sw-admin-icon" src={row.iconUrl} alt="" loading="lazy" />
                  ) : (
                    <span className="sw-admin-icon sw-admin-icon-fallback">
                      {nameInitial(row.name)}
                    </span>
                  )}
                  <div className="sw-admin-name-text">
                    <div style={{ fontWeight: 600 }}>{row.name}</div>
                    <div className="muted" style={{ fontSize: 11.5, wordBreak: 'break-all' }}>
                      {row.filename}
                    </div>
                  </div>
                </div>
              ),
            },
            {
              title: '版本',
              dataIndex: 'version',
              width: 90,
              render: (value: string) => (value ? <span className="mono">{value}</span> : <span className="muted">—</span>),
            },
            {
              title: '分类',
              dataIndex: 'category',
              width: 150,
              render: (value: string) => <CategoryCell value={value} />,
            },
            {
              title: '标签',
              dataIndex: 'tags',
              width: 150,
              render: (tags: string[]) => <TagsCell tags={tags} />,
            },
            { title: '平台', dataIndex: 'platform', width: 120, render: (value: string) => value || <span className="muted">—</span> },
            {
              title: '大小',
              dataIndex: 'size_bytes',
              width: 90,
              render: (value: number) => formatBytes(value),
            },
            {
              title: '来源',
              dataIndex: 'source',
              width: 76,
              render: (value: string) => {
                const meta = SOURCE_TAGS[value] ?? { color: 'default', label: value };
                return (
                  <Tag color={meta.color} style={{ borderRadius: 999 }}>
                    {meta.label}
                  </Tag>
                );
              },
            },
            {
              title: '下载量',
              dataIndex: 'download_count',
              width: 76,
              render: (value: number) => formatNumber(value),
            },
            {
              title: '更新时间',
              dataIndex: 'updated_at',
              width: 130,
              render: (value: string) => (
                <span className="muted" style={{ fontSize: 12 }}>
                  {formatDate(value)}
                </span>
              ),
            },
            {
              title: '操作',
              key: 'actions',
              width: 170,
              fixed: 'right',
              render: (_, row) => (
                <Space>
                  <Button size="small" type="link" onClick={() => openEdit(row)}>
                    编辑
                  </Button>
                  <DownloadButton
                    resourceType="software"
                    artifactId={row.id}
                    filename={row.filename}
                    label="下载"
                    size="small"
                    buttonType="link"
                  />
                  <Popconfirm
                    title="删除该软件包？"
                    description="会同时删除文件本身，且不可恢复。"
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
          locale={{ emptyText: '还没有软件包，上传或扫描目录开始' }}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <Pagination
            current={data?.page ?? 1}
            pageSize={data?.pageSize ?? 20}
            total={data?.total ?? 0}
            showTotal={(total) => `共 ${total} 条`}
            onChange={(nextPage) => setPage(nextPage)}
          />
        </div>
      </div>

      <Modal
        open={uploadOpen}
        title="上传软件包"
        width={680}
        okText="上传并发布"
        cancelText="取消"
        confirmLoading={uploading}
        onOk={() => void handleUpload()}
        onCancel={() => {
          setUploadOpen(false);
          setUploadFile(null);
          setUploadIconFile(null);
          uploadForm.resetFields();
        }}
      >
        <div className="stack" style={{ gap: 12 }}>
          <Upload.Dragger
            multiple={false}
            showUploadList
            maxCount={1}
            disabled={uploading}
            beforeUpload={(file) => {
              setUploadFile(file);
              // 按文件名自动识别名称/版本/平台，识别失败时保留用户已填内容
              const detected = detectSoftwareMeta(file.name);
              uploadForm.setFieldsValue({
                ...(detected.name ? { name: detected.name } : {}),
                ...(detected.version ? { version: detected.version } : {}),
                ...(detected.platform ? { platform: detected.platform } : {}),
              });
              return false;
            }}
            onRemove={() => {
              setUploadFile(null);
            }}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">选择安装包文件（exe / msi / zip / dmg / deb 等）</p>
            <p className="ant-upload-hint">
              自动识别软件名称、版本与平台架构，识别结果可手动修改 · 大小上限可在系统设置中调整
            </p>
          </Upload.Dragger>
          <Form form={uploadForm} layout="vertical">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Form.Item label="软件名称" name="name">
                <Input placeholder="选择文件后自动识别" />
              </Form.Item>
              <Form.Item label="版本" name="version">
                <Input placeholder="例如 2.1.0" />
              </Form.Item>
              <Form.Item label="平台/架构" name="platform">
                <Select options={platformOptions} placeholder="选择目标平台" allowClear showSearch />
              </Form.Item>
              <Form.Item label="分类归档" name="category">
                <CategoryTreeSelect categories={categories} />
              </Form.Item>
            </div>
            <Form.Item
              label="标签"
              name="tags"
              extra="最多 12 个标签，用于前台快速筛选；输入后回车确认"
            >
              {renderTagSelect('如：内网常用、免安装、国产')}
            </Form.Item>
            <Form.Item label="软件图标（可选）" extra="png / jpg / webp / gif，不超过 512KB；图标保存在本站，离线可用">
              <Upload
                multiple={false}
                showUploadList
                maxCount={1}
                accept=".png,.jpg,.jpeg,.webp,.gif"
                disabled={uploading}
                beforeUpload={(file) => {
                  setUploadIconFile(file);
                  return false;
                }}
                onRemove={() => setUploadIconFile(null)}
              >
                <Button icon={<PictureOutlined />}>选择图标</Button>
              </Upload>
            </Form.Item>
            <Form.Item label="说明文档（Markdown）" name="description_md">
              <TextArea rows={6} placeholder="软件简介、安装步骤、注意事项…" />
            </Form.Item>
            {uploadMarkdown ? (
              <Button size="small" onClick={() => setPreview((value) => !value)}>
                {preview ? '编辑' : '预览说明'}
              </Button>
            ) : null}
            {preview && uploadMarkdown ? <MarkdownView content={uploadMarkdown} /> : null}
          </Form>
        </div>
      </Modal>

      <Modal
        open={Boolean(editing)}
        title={`编辑软件包：${editing?.name ?? ''}`}
        width={720}
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
        onOk={() => void saveEdit()}
        onCancel={() => setEditing(null)}
      >
        <Form form={editForm} layout="vertical">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item label="软件名称" name="name" rules={[{ required: true, message: '请输入名称' }]}>
              <Input />
            </Form.Item>
            <Form.Item label="版本" name="version">
              <Input />
            </Form.Item>
            <Form.Item label="平台/架构" name="platform">
              <Select options={platformOptions} allowClear showSearch placeholder="选择目标平台" />
            </Form.Item>
            <Form.Item label="分类归档" name="category">
              <CategoryTreeSelect categories={categories} />
            </Form.Item>
          </div>
          <Form.Item label="标签" name="tags" extra="最多 12 个标签，用于前台快速筛选">
            {renderTagSelect('添加或选择标签')}
          </Form.Item>
          <Form.Item label="软件图标">
            <div className="icon-manage">
              {editing?.iconUrl ? (
                <img className="sw-admin-icon" src={editing.iconUrl} alt="" />
              ) : (
                <span className="sw-admin-icon sw-admin-icon-fallback">
                  {nameInitial(editing?.name ?? '?')}
                </span>
              )}
              <Upload
                multiple={false}
                showUploadList={false}
                maxCount={1}
                accept=".png,.jpg,.jpeg,.webp,.gif"
                disabled={iconBusy}
                beforeUpload={(file) => {
                  setEditIconFile(file);
                  return false;
                }}
              >
                <Button size="small" icon={<PictureOutlined />}>
                  {editing?.iconUrl ? '替换图标' : '上传图标'}
                </Button>
              </Upload>
              {editIconFile ? (
                <Button size="small" type="primary" loading={iconBusy} onClick={() => void replaceIcon()}>
                  保存图标
                </Button>
              ) : null}
              {editing?.iconUrl ? (
                <Button size="small" danger loading={iconBusy} onClick={() => void removeIcon()}>
                  移除
                </Button>
              ) : null}
              {editIconFile ? (
                <span className="muted" style={{ fontSize: 12 }}>
                  已选择：{editIconFile.name}
                </span>
              ) : null}
            </div>
          </Form.Item>
          <Form.Item label="说明文档（Markdown）" name="description_md">
            <TextArea rows={10} />
          </Form.Item>
          {editMarkdown ? (
            <Button size="small" onClick={() => setPreview((value) => !value)}>
              {preview ? '编辑' : '预览说明'}
            </Button>
          ) : null}
          {preview && editMarkdown ? <MarkdownView content={editMarkdown} /> : null}
        </Form>
      </Modal>

      <Modal
        open={batchCategoryOpen}
        title={`批量设置分类（${selectedIds.length} 项）`}
        okText="应用"
        cancelText="取消"
        confirmLoading={batchBusy}
        onOk={() => void submitBatchCategory()}
        onCancel={() => setBatchCategoryOpen(false)}
      >
        <Form form={batchCategoryForm} layout="vertical">
          <Form.Item
            label="目标分类"
            name="category"
            rules={[{ required: true, message: '请选择或新建分类' }]}
          >
            <CategoryTreeSelect categories={categories} placeholder="选择或新建目标分类" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={batchTagMode !== null}
        title={`${batchTagMode === 'add' ? '批量添加标签' : '批量移除标签'}（${selectedIds.length} 项）`}
        okText="应用"
        cancelText="取消"
        confirmLoading={batchBusy}
        onOk={() => void submitBatchTags()}
        onCancel={() => setBatchTagMode(null)}
      >
        <Form form={batchTagForm} layout="vertical">
          <Form.Item
            label="标签"
            name="tags"
            rules={[{ required: true, message: '请至少输入一个标签' }]}
          >
            {renderTagSelect(batchTagMode === 'add' ? '输入要添加的标签' : '输入要移除的标签')}
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={renameOpen}
        title="分类重命名"
        okText="确认"
        cancelText="取消"
        onOk={() => void renameCategory()}
        onCancel={() => setRenameOpen(false)}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="重命名父级分类时，其子分类会同步更新前缀（如「开发工具/IDE」随「开发工具」一起改名）。"
        />
        <Form form={renameForm} layout="vertical">
          <Form.Item label="原分类" name="from" rules={[{ required: true, message: '请选择原分类' }]}>
            <CategoryTreeSelect categories={categories} allowCreate={false} showCount placeholder="选择要重命名的分类" />
          </Form.Item>
          <Form.Item
            label="新分类路径"
            name="to"
            rules={[{ required: true, message: '请输入新分类路径' }]}
            extra="支持多级路径，如：开发工具/IDE"
          >
            <Input maxLength={80} placeholder="如：效率工具/IDE" />
          </Form.Item>
        </Form>
      </Modal>
      <Drawer
        open={submissionsOpen}
        onClose={() => setSubmissionsOpen(false)}
        width={560}
        title="投稿审核"
        extra={
          <Select<SubmissionStatus | 'all'>
            style={{ width: 110 }}
            value={submissionsStatus}
            onChange={(value) => {
              const next = value === 'all' ? 'pending' : value;
              setSubmissionsStatus(next);
              loadSubmissions(next);
            }}
            options={[
              { value: 'pending', label: '待审核' },
              { value: 'approved', label: '已通过' },
              { value: 'rejected', label: '已拒绝' },
            ]}
          />
        }
      >
        {submissionsLoading ? (
          <Skeleton active paragraph={{ rows: 6 }} />
        ) : submissions.length > 0 ? (
          <div className="stack">
            {submissions.map((row) => (
              <div key={row.id} className="panel panel-tight submission-card">
                <div className="row-between">
                  <strong>{row.name}</strong>
                  <Tag
                    color={row.status === 'pending' ? 'orange' : row.status === 'approved' ? 'green' : 'red'}
                    style={{ borderRadius: 999 }}
                  >
                    {row.status === 'pending' ? '待审核' : row.status === 'approved' ? '已通过' : '已拒绝'}
                  </Tag>
                </div>
                <div className="muted submission-meta">
                  {row.version ? `v${row.version} · ` : ''}
                  {formatBytes(row.size_bytes)} · {formatDate(row.created_at)}
                </div>
                <div className="muted submission-meta" style={{ wordBreak: 'break-all' }}>
                  {row.filename}
                </div>
                {row.note ? <div className="submission-note">备注：{row.note}</div> : null}
                {row.tags.length > 0 ? (
                  <div className="tag-cell">
                    {row.tags.map((tag) => (
                      <Tag key={tag}>{tag}</Tag>
                    ))}
                  </div>
                ) : null}
                <Space style={{ marginTop: 8 }}>
                  {row.status === 'pending' ? (
                    <Button size="small" type="primary" onClick={() => openReview(row)}>
                      审核
                    </Button>
                  ) : null}
                  {row.status === 'approved' && row.package_id ? (
                    <Button size="small" type="link" onClick={() => void load()}>
                      已合并为 #{row.package_id}
                    </Button>
                  ) : null}
                  {row.status === 'rejected' ? (
                    <Popconfirm
                      title="删除该投稿记录？"
                      okText="删除"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => void removeSubmission(row.id)}
                    >
                      <Button size="small" danger type="link">
                        删除记录
                      </Button>
                    </Popconfirm>
                  ) : null}
                </Space>
              </div>
            ))}
            <span className="muted" style={{ fontSize: 12 }}>
              共 {submissionsTotal} 条
            </span>
          </div>
        ) : (
          <Empty description={submissionsStatus === 'pending' ? '暂无待审核投稿' : '暂无记录'} />
        )}
      </Drawer>

      <Modal
        open={Boolean(reviewing)}
        title={`审核投稿：${reviewing?.name ?? ''}`}
        width={640}
        footer={null}
        onCancel={() => setReviewing(null)}
      >
        {reviewing ? (
          <div className="stack">
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label="文件名" span={2}>
                <span style={{ wordBreak: 'break-all' }}>{reviewing.filename}</span>
              </Descriptions.Item>
              <Descriptions.Item label="大小">{formatBytes(reviewing.size_bytes)}</Descriptions.Item>
              <Descriptions.Item label="版本">{reviewing.version || '—'}</Descriptions.Item>
              <Descriptions.Item label="平台">{reviewing.platform || '—'}</Descriptions.Item>
              <Descriptions.Item label="提交时间">{formatDate(reviewing.created_at)}</Descriptions.Item>
            </Descriptions>

            {reviewing.description_md ? (
              <div className="submission-note" style={{ maxHeight: 180, overflow: 'auto' }}>
                <MarkdownView content={reviewing.description_md} />
              </div>
            ) : null}

            <Form form={reviewForm} layout="vertical">
              <Form.Item label="分类" name="category" extra="留空则沿用投稿人选择的分类；可输入新路径">
                <CategoryTreeSelect categories={categories} placeholder="选择或新建分类" />
              </Form.Item>
              <Form.Item label="标签" name="tags">
                {renderTagSelect('审核时可修改标签')}
              </Form.Item>
              <Form.Item label="备注" name="note" extra="修改后会同步保存到投稿记录">
                <Input.TextArea rows={2} maxLength={500} />
              </Form.Item>
              <Form.Item label="拒绝理由（拒绝时填写）" name="comment">
                <Input maxLength={500} placeholder="例如：与现有软件重复" />
              </Form.Item>
            </Form>

            <div className="row-between">
              <Popconfirm
                title="拒绝该投稿？"
                description="投稿文件会被删除，记录保留供追溯。"
                okText="拒绝"
                cancelText="取消"
                okButtonProps={{ danger: true }}
                onConfirm={() => void rejectReview()}
              >
                <Button danger loading={reviewBusy}>
                  拒绝
                </Button>
              </Popconfirm>
              <Button type="primary" loading={reviewBusy} onClick={() => void approveReview()}>
                同意并上架
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
