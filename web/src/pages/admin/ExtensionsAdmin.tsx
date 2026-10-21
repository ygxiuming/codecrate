import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Descriptions,
  Input,
  Pagination,
  Popconfirm,
  Space,
  Table,
  Tag,
  Upload,
  message,
} from 'antd';
import { InboxOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { api, qs } from '../../api/client';
import type { StorageArtifact } from '../../api/types';
import { DownloadButton } from '../../components/DownloadButton';
import { Sha256 } from '../../components/Sha256';
import { formatBytes, formatDate, formatNumber } from '../../lib/format';

interface UploadResult {
  artifactId: number;
  filename: string;
  sizeBytes: number;
  sha256: string;
  iconUrl: string | null;
  metadata: {
    extensionId: string;
    publisher: string;
    name: string;
    version: string;
    displayName: string;
    description: string;
    engineRange?: string;
    categories: string[];
    keywords: string[];
    dependencies: string[];
    extensionPack: string[];
    license?: string;
    repositoryUrl?: string;
    homepage?: string;
  };
}

export function ExtensionsAdminPage() {
  const [data, setData] = useState<{ items: StorageArtifact[]; total: number; page: number; pageSize: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [keyword, setKeyword] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get<{ items: StorageArtifact[]; total: number; page: number; pageSize: number }>(
        `/api/admin/extensions${qs({ page, pageSize: 20, q })}`,
      )
      .then(setData)
      .catch((error) => message.error((error as Error).message))
      .finally(() => setLoading(false));
  }, [page, q]);

  useEffect(() => {
    load();
  }, [load]);

  const handleUpload = async (file: File): Promise<void> => {
    setUploading(true);
    try {
      const result = await api.upload<UploadResult>('/api/admin/extensions/upload', file);
      setUploadResult(result);
      message.success(`插件 ${result.metadata.extensionId}@${result.metadata.version} 已入库`);
      load();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const remove = async (id: number): Promise<void> => {
    try {
      await api.del(`/api/admin/extensions/${id}`);
      message.success('已删除插件');
      load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  return (
    <div className="stack">
      <div className="page-title">
        <h2>插件管理</h2>
        <p>上传 .vsix 后系统自动解析元数据并入库；也可从市场一键缓存。上传大小上限可在设置中调整。</p>
      </div>

      <div className="panel">
        <Upload.Dragger
          name="file"
          accept=".vsix"
          multiple={false}
          showUploadList={false}
          disabled={uploading}
          beforeUpload={(file: File) => {
            if (!/\.vsix$/i.test(file.name)) {
              message.error('只允许上传 .vsix 文件');
              return Upload.LIST_IGNORE;
            }
            void handleUpload(file);
            return Upload.LIST_IGNORE;
          }}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">点击或拖拽 .vsix 文件到此处上传</p>
          <p className="ant-upload-hint">
            {uploading ? '正在上传并解析元数据…' : '系统会解析 Publisher、版本、引擎范围、依赖、分类与图标'}
          </p>
        </Upload.Dragger>

        {uploadResult ? (
          <div style={{ marginTop: 18 }}>
            <Alert
              type="success"
              showIcon
              message={`解析成功：${uploadResult.metadata.displayName} v${uploadResult.metadata.version}`}
              style={{ marginBottom: 14 }}
            />
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label="插件 ID">{uploadResult.metadata.extensionId}</Descriptions.Item>
              <Descriptions.Item label="Publisher">{uploadResult.metadata.publisher}</Descriptions.Item>
              <Descriptions.Item label="引擎范围">
                {uploadResult.metadata.engineRange ?? '未声明'}
              </Descriptions.Item>
              <Descriptions.Item label="大小">{formatBytes(uploadResult.sizeBytes)}</Descriptions.Item>
              <Descriptions.Item label="分类" span={2}>
                {uploadResult.metadata.categories.map((item) => (
                  <Tag key={item} style={{ borderRadius: 999 }}>
                    {item}
                  </Tag>
                ))}
              </Descriptions.Item>
              <Descriptions.Item label="依赖" span={2}>
                {uploadResult.metadata.dependencies.length > 0
                  ? uploadResult.metadata.dependencies.join(', ')
                  : '无'}
              </Descriptions.Item>
              <Descriptions.Item label="Extension Pack" span={2}>
                {uploadResult.metadata.extensionPack.length > 0
                  ? uploadResult.metadata.extensionPack.join(', ')
                  : '无'}
              </Descriptions.Item>
              <Descriptions.Item label="SHA256" span={2}>
                <Sha256 value={uploadResult.sha256} compact={false} />
              </Descriptions.Item>
            </Descriptions>
          </div>
        ) : null}
      </div>

      <div className="panel">
        <div className="toolbar-inline" style={{ marginBottom: 14 }}>
          <Input
            allowClear
            style={{ width: 280 }}
            prefix={<SearchOutlined style={{ color: '#7c93a9' }} />}
            placeholder="搜索插件名、Publisher 或文件名"
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
          <span style={{ marginLeft: 'auto' }} className="muted">
            共 {formatNumber(data?.total ?? 0)} 条记录
          </span>
        </div>

        <Table<StorageArtifact>
          rowKey="id"
          size="middle"
          loading={loading}
          dataSource={data?.items ?? []}
          pagination={false}
          scroll={{ x: 1080 }}
          columns={[
            {
              title: '插件',
              key: 'name',
              width: 260,
              render: (_, row) => (
                <div>
                  <div style={{ fontWeight: 600 }}>{row.display_name || row.extension_id}</div>
                  <div className="muted mono" style={{ fontSize: 11.5 }}>
                    {row.extension_id}
                  </div>
                </div>
              ),
            },
            { title: '版本', dataIndex: 'version', width: 140, render: (value: string) => <span className="mono">{value}</span> },
            {
              title: '平台',
              dataIndex: 'target_platform',
              width: 120,
              render: (value: string) => (
                <Tag style={{ borderRadius: 999 }}>{value || '通用'}</Tag>
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
              title: '下载量',
              dataIndex: 'download_count',
              width: 90,
              render: (value: number) => formatNumber(value),
            },
            {
              title: '上传时间',
              dataIndex: 'created_at',
              width: 150,
              render: (value: string) => (
                <span className="muted" style={{ fontSize: 12 }}>
                  {formatDate(value)}
                </span>
              ),
            },
            {
              title: '操作',
              key: 'actions',
              width: 160,
              fixed: 'right',
              render: (_, row) => (
                <Space>
                  <DownloadButton
                    resourceType="extension"
                    artifactId={row.id}
                    filename={row.filename}
                    label="下载"
                    size="small"
                    buttonType="link"
                  />
                  <Popconfirm
                    title="删除该插件版本？"
                    description="会同时删除文件、图标与分类关联，且不可恢复。"
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
          locale={{ emptyText: '还没有缓存插件' }}
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
    </div>
  );
}
