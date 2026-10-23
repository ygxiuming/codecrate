import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Pagination,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Upload,
  message,
} from 'antd';
import {
  CloudSyncOutlined,
  InboxOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import { api, qs } from '../../api/client';
import type {
  AdminSoftwareCategory,
  AdminSoftwareRow,
  SoftwareScanResult,
} from '../../api/types';
import { DownloadButton } from '../../components/DownloadButton';
import { MarkdownView } from '../../components/MarkdownView';
import { Sha256 } from '../../components/Sha256';
import { formatBytes, formatDate, formatNumber } from '../../lib/format';
import { SOFTWARE_PLATFORM_OPTIONS, detectSoftwareMeta } from '../../lib/softwareMeta';
import { showUploadDuplicateModal } from '../../lib/uploadErrors';

const { TextArea } = Input;

const platformOptions = SOFTWARE_PLATFORM_OPTIONS.map((value) => ({ value, label: value }));

interface UploadFormValues {
  name?: string;
  version?: string;
  platform?: string;
  category?: string;
  description_md?: string;
}

export function SoftwareAdminPage() {
  const [data, setData] = useState<{
    items: AdminSoftwareRow[];
    total: number;
    page: number;
    pageSize: number;
  } | null>(null);
  const [categories, setCategories] = useState<AdminSoftwareCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [q, setQ] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [page, setPage] = useState(1);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadForm] = Form.useForm<UploadFormValues>();
  const [preview, setPreview] = useState(false);

  const [editing, setEditing] = useState<AdminSoftwareRow | null>(null);
  const [editForm] = Form.useForm<UploadFormValues>();
  const [saving, setSaving] = useState(false);

  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<SoftwareScanResult | null>(null);

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameForm] = Form.useForm<{ from: string; to: string }>();

  const [newCategory, setNewCategory] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api
      .get<{
        items: AdminSoftwareRow[];
        total: number;
        page: number;
        pageSize: number;
      }>(`/api/admin/software${qs({ page, pageSize: 20, q, category: categoryFilter || undefined })}`)
      .then(setData)
      .catch((error) => message.error((error as Error).message))
      .finally(() => setLoading(false));
  }, [page, q, categoryFilter]);

  const loadCategories = useCallback(() => {
    api
      .get<{ items: AdminSoftwareCategory[] }>('/api/admin/software/categories')
      .then((result) => setCategories(result.items))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  const categoryOptions = categories.map((item) => ({ value: item.category }));

  /** 在下拉底部内联新增分类：直接把输入值设为当前表单的分类字段。 */
  const applyNewCategory = (form: typeof uploadForm): void => {
    const value = newCategory.trim();
    if (!value) {
      message.warning('请输入新分类名称');
      return;
    }
    if (value.length > 80) {
      message.warning('分类名称过长');
      return;
    }
    form.setFieldValue('category', value);
    setNewCategory('');
    message.success(`已选择新分类「${value}」，保存后生效`);
  };

  const renderCategorySelect = (form: typeof uploadForm): JSX.Element => (
    <Select
      showSearch
      allowClear
      placeholder="选择分类，可在底部新建"
      options={categoryOptions}
      filterOption={(input, option) =>
        String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())
      }
      popupRender={(menu) => (
        <div onClick={(event) => event.stopPropagation()}>
          {menu}
          <div style={{ display: 'flex', gap: 6, padding: 8, borderTop: '1px solid #f0f0f0' }}>
            <Input
              size="small"
              placeholder="新分类名称"
              value={newCategory}
              onChange={(event) => setNewCategory(event.target.value)}
              onPressEnter={() => applyNewCategory(form)}
              maxLength={80}
            />
            <Button
              size="small"
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => applyNewCategory(form)}
            >
              添加
            </Button>
          </div>
        </div>
      )}
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
      const result = await api.upload<{ id: number; name: string }>('/api/admin/software/upload', uploadFile, 'file', {
        name: values.name || undefined,
        version: values.version || undefined,
        platform: values.platform || undefined,
        category: values.category || undefined,
        description_md: values.description_md || undefined,
      });
      message.success(`软件包「${result.name}」已发布`);
      setUploadOpen(false);
      setUploadFile(null);
      uploadForm.resetFields();
      load();
      loadCategories();
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
      await api.put(`/api/admin/software/${editing.id}`, values);
      message.success('已保存');
      setEditing(null);
      load();
      loadCategories();
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
      load();
      loadCategories();
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
      load();
      loadCategories();
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
      load();
      loadCategories();
    } catch (error) {
      message.error((error as Error).message);
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
        </p>
      </div>

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
            style={{ width: 260 }}
            prefix={<SearchOutlined style={{ color: '#7c93a9' }} />}
            placeholder="搜索软件名、版本、文件名"
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
            value={categoryFilter || undefined}
            options={categoryOptions}
            onChange={(value) => {
              setPage(1);
              setCategoryFilter(value ?? '');
            }}
          />
          <Button icon={<ReloadOutlined />} onClick={load}>
            刷新
          </Button>
          <span className="muted" style={{ marginLeft: 'auto' }}>
            共 {formatNumber(data?.total ?? 0)} 条记录
          </span>
        </div>

        <Table<AdminSoftwareRow>
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
                <div>
                  <div style={{ fontWeight: 600 }}>{row.name}</div>
                  <div className="muted" style={{ fontSize: 11.5, wordBreak: 'break-all' }}>
                    {row.filename}
                  </div>
                </div>
              ),
            },
            {
              title: '版本',
              dataIndex: 'version',
              width: 100,
              render: (value: string) => (value ? <span className="mono">{value}</span> : <span className="muted">—</span>),
            },
            {
              title: '分类',
              dataIndex: 'category',
              width: 110,
              render: (value: string) => <Tag style={{ borderRadius: 999 }}>{value}</Tag>,
            },
            { title: '平台', dataIndex: 'platform', width: 130, render: (value: string) => value || '—' },
            {
              title: '大小',
              dataIndex: 'size_bytes',
              width: 90,
              render: (value: number) => formatBytes(value),
            },
            {
              title: '来源',
              dataIndex: 'source',
              width: 80,
              render: (value: string) => (
                <Tag color={value === 'scan' ? 'blue' : 'green'} style={{ borderRadius: 999 }}>
                  {value === 'scan' ? '扫描' : '上传'}
                </Tag>
              ),
            },
            {
              title: '下载量',
              dataIndex: 'download_count',
              width: 80,
              render: (value: number) => formatNumber(value),
            },
            {
              title: '更新时间',
              dataIndex: 'updated_at',
              width: 140,
              render: (value: string) => (
                <span className="muted" style={{ fontSize: 12 }}>
                  {formatDate(value)}
                </span>
              ),
            },
            {
              title: '操作',
              key: 'actions',
              width: 180,
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
                <Select
                  options={platformOptions}
                  placeholder="选择目标平台"
                  allowClear
                  showSearch
                />
              </Form.Item>
              <Form.Item label="分类归档" name="category">
                {renderCategorySelect(uploadForm)}
              </Form.Item>
            </div>
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
              {renderCategorySelect(editForm)}
            </Form.Item>
          </div>
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
        open={renameOpen}
        title="分类重命名"
        okText="确认"
        cancelText="取消"
        onOk={() => void renameCategory()}
        onCancel={() => setRenameOpen(false)}
      >
        <Form form={renameForm} layout="vertical">
          <Form.Item label="原分类" name="from" rules={[{ required: true, message: '请选择原分类' }]}>
            <Select options={categoryOptions} placeholder="选择要重命名的分类" />
          </Form.Item>
          <Form.Item label="新分类名" name="to" rules={[{ required: true, message: '请输入新分类名' }]}>
            <Input maxLength={80} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
