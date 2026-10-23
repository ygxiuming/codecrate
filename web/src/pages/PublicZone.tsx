import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Result,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd';
import {
  CloudUploadOutlined,
  CopyOutlined,
  FileOutlined,
  QrcodeOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { api } from '../api/client';
import type { PublicFile, PublicFileListResponse, ShareCreateResult } from '../api/types';
import { DownloadButton } from '../components/DownloadButton';
import { copyText, formatBytes, formatDate, formatNumber, isPermanentExpiry } from '../lib/format';
import { showUploadDuplicateModal } from '../lib/uploadErrors';

function timeLeft(expiresAt: string): string {
  if (isPermanentExpiry(expiresAt)) return '永久有效';
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return '已过期';
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '不足 1 分钟';
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时 ${minutes % 60} 分`;
  const days = Math.floor(hours / 24);
  return `${days} 天 ${hours % 24} 小时`;
}

function PublicZoneTab() {
  const [data, setData] = useState<PublicFileListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [keyword, setKeyword] = useState('');
  const [q, setQ] = useState('');
  const [uploading, setUploading] = useState(false);
  const [note, setNote] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const load = useCallback(
    (nextPage = page, nextSize = pageSize, nextQ = q) => {
      setLoading(true);
      api
        .get<PublicFileListResponse>(
          `/api/public/files?page=${nextPage}&pageSize=${nextSize}${nextQ ? `&q=${encodeURIComponent(nextQ)}` : ''}`,
        )
        .then(setData)
        .catch(() => setData(null))
        .finally(() => setLoading(false));
    },
    [page, pageSize, q],
  );

  useEffect(() => {
    load(page, pageSize, q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, q]);

  const confirmUpload = async (): Promise<void> => {
    if (!pendingFile) {
      message.warning('请先选择要上传的文件');
      return;
    }
    setUploading(true);
    try {
      await api.upload('/api/public/files', pendingFile, 'file', { note: note.trim() || undefined });
      message.success('上传成功，感谢分享');
      setNote('');
      setPendingFile(null);
      setPage(1);
      load(1, pageSize, q);
    } catch (uploadError) {
      showUploadDuplicateModal(uploadError);
    } finally {
      setUploading(false);
    }
  };

  const limits = data?.limits;

  const pickFile = (file: File): boolean => {
    if (limits?.blockedExtensions.length) {
      const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
      if (extension && limits.blockedExtensions.includes(extension)) {
        message.error(`不允许上传 .${extension} 类型文件`);
        return false;
      }
    }
    if (limits?.maxFileBytes && file.size > limits.maxFileBytes) {
      message.error(`文件超过大小限制 ${formatBytes(limits.maxFileBytes)}`);
      return false;
    }
    setPendingFile(file);
    return true;
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <Card size="small">
        <div className="stack" style={{ gap: 10 }}>
          <Upload.Dragger
            showUploadList={false}
            disabled={uploading}
            maxCount={1}
            beforeUpload={(file) => {
              pickFile(file);
              return Upload.LIST_IGNORE;
            }}
            onRemove={() => setPendingFile(null)}
          >
            <p className="ant-upload-drag-icon">
              <CloudUploadOutlined style={{ color: '#0078d4' }} />
            </p>
            <p className="ant-upload-text">点击或拖拽文件到此处上传到公共区</p>
            <p className="ant-upload-hint">
              {limits
                ? `单文件 ≤ ${formatBytes(limits.maxFileBytes)} · 上传后 ${limits.retentionDays} 天自动删除 · 所有人可见 · 内容重复会被拒绝`
                : '上传后所有人可见，到期自动删除 · 内容重复会被拒绝'}
            </p>
          </Upload.Dragger>
          {pendingFile ? (
            <Alert
              type="info"
              showIcon
              message={`已选择：${pendingFile.name}（${formatBytes(pendingFile.size)}）`}
              description="确认无误后点击「确认上传」；文件将公开给所有人，到期自动删除。"
            />
          ) : null}
          <Input
            placeholder="备注（选填，例如：给测试组的驱动包）"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={300}
          />
          <div className="row-between">
            <span className="muted" style={{ fontSize: 12 }}>
              {uploading ? '正在上传，大文件请耐心等待…' : '选择文件 → 填写备注 → 确认上传'}
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              {pendingFile ? (
                <Button onClick={() => setPendingFile(null)} disabled={uploading}>
                  重新选择
                </Button>
              ) : null}
              <Button
                type="primary"
                icon={<CloudUploadOutlined />}
                loading={uploading}
                disabled={!pendingFile}
                onClick={() => void confirmUpload()}
              >
                确认上传
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <div className="panel" style={{ padding: 0 }}>
        <div className="row-between" style={{ padding: '14px 16px 0', gap: 10, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 14 }}>公共文件（{formatNumber(data?.total ?? 0)}）</strong>
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
            <Input.Search
              allowClear
              size="small"
              style={{ width: 240 }}
              placeholder="搜索文件名或备注"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              onSearch={(value) => {
                setPage(1);
                setQ(value.trim());
              }}
            />
            <Button icon={<ReloadOutlined />} size="small" onClick={() => load()}>
              刷新
            </Button>
          </div>
        </div>
        <Table<PublicFile>
          rowKey="id"
          size="middle"
          style={{ marginTop: 8 }}
          loading={loading}
          dataSource={data?.items ?? []}
          pagination={{
            current: data?.page ?? 1,
            pageSize: data?.pageSize ?? pageSize,
            total: data?.total ?? 0,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50],
            onChange: (nextPage, nextSize) => {
              setPage(nextPage);
              setPageSize(nextSize);
            },
            showTotal: (total) => `共 ${total} 个文件`,
          }}
          columns={[
            {
              title: '文件',
              key: 'filename',
              render: (_, row) => (
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <FileOutlined style={{ color: '#0078d4', flexShrink: 0 }} />
                    <strong style={{ wordBreak: 'break-all' }}>{row.filename}</strong>
                  </div>
                  {row.note ? (
                    <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                      备注：{row.note}
                    </div>
                  ) : null}
                </div>
              ),
            },
            {
              title: '大小',
              dataIndex: 'sizeBytes',
              width: 100,
              render: (value: number) => formatBytes(value),
            },
            {
              title: '下载量',
              dataIndex: 'downloadCount',
              width: 90,
              render: (value: number) => formatNumber(value),
            },
            {
              title: '上传时间',
              dataIndex: 'createdAt',
              width: 150,
              render: (value: string) => (
                <span className="muted" style={{ fontSize: 12 }}>
                  {formatDate(value)}
                </span>
              ),
            },
            {
              title: '剩余有效期',
              key: 'expiry',
              width: 170,
              render: (_, row) => {
                const permanent = isPermanentExpiry(row.expiresAt);
                return (
                  <div>
                    <Tag color={permanent ? 'blue' : new Date(row.expiresAt).getTime() - Date.now() < 86_400_000 ? 'gold' : 'green'} style={{ borderRadius: 999 }}>
                      <span className="zone-countdown">
                        {permanent ? '∞ 永久有效' : `⏳ ${timeLeft(row.expiresAt)}`}
                      </span>
                    </Tag>
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                      {permanent ? '不自动删除' : `${formatDate(row.expiresAt)} 自动删除`}
                    </div>
                  </div>
                );
              },
            },
            {
              title: '操作',
              key: 'actions',
              width: 100,
              render: (_, row) => (
                <DownloadButton
                  resourceType="public_file"
                  artifactId={row.id}
                  filename={row.filename}
                  label="下载"
                  size="small"
                />
              ),
            },
          ]}
          locale={{ emptyText: '公共区还没有文件，来上传第一个吧' }}
        />
      </div>
    </div>
  );
}

function ShareTab() {
  const [form] = Form.useForm();
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ShareCreateResult | null>(null);
  const [shareEnabled, setShareEnabled] = useState(true);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  useEffect(() => {
    api
      .get<{ shareEnabled: boolean }>('/api/public/config')
      .then((config) => setShareEnabled(config.shareEnabled !== false))
      .catch(() => undefined);
  }, []);

  const submit = async (): Promise<void> => {
    if (!pendingFile) {
      message.warning('请先选择要传递的文件');
      return;
    }
    const values = await form.validateFields();
    setUploading(true);
    try {
      const created = await api.upload<ShareCreateResult>('/api/public/share', pendingFile, 'file', {
        note: values.note || undefined,
        pickup_code: values.pickup_code || undefined,
        expires_hours: values.expires_hours ? String(values.expires_hours) : undefined,
        max_downloads: values.max_downloads ? String(values.max_downloads) : undefined,
      });
      setResult(created);
      form.resetFields();
      setPendingFile(null);
    } catch (shareError) {
      message.error((shareError as Error).message);
    } finally {
      setUploading(false);
    }
  };

  if (!shareEnabled) {
    return (
      <Result
        status="404"
        title="私人传递未开启"
        subTitle="管理员已关闭私人文件传递功能。"
      />
    );
  }

  return (
    <div className="stack" style={{ gap: 16, maxWidth: 640 }}>
      <Card size="small">
        <Form form={form} layout="vertical">
          <Form.Item label="备注（选填）" name="note">
            <Input placeholder="例如：会议纪要，给王工" maxLength={300} />
          </Form.Item>
          <Form.Item
            label="自定义取件码（选填，4-16 位字母/数字）"
            name="pickup_code"
            rules={[
              {
                pattern: /^[A-Za-z0-9]{4,16}$/,
                message: '取件码需为 4-16 位字母或数字',
              },
            ]}
          >
            <Input
              placeholder="留空则自动生成 8 位取件码"
              maxLength={16}
              style={{ fontFamily: 'monospace', letterSpacing: 1 }}
            />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item label="有效期（小时）" name="expires_hours" initialValue={72}>
              <InputNumber min={1} max={8760} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="限下载次数（选填）" name="max_downloads">
              <InputNumber min={1} max={10000} style={{ width: '100%' }} placeholder="不限" />
            </Form.Item>
          </div>
        </Form>
        <Upload.Dragger
          showUploadList={false}
          disabled={uploading}
          maxCount={1}
          beforeUpload={(file) => {
            setPendingFile(file);
            return Upload.LIST_IGNORE;
          }}
          onRemove={() => setPendingFile(null)}
        >
          <p className="ant-upload-drag-icon">
            <QrcodeOutlined style={{ color: '#0078d4' }} />
          </p>
          <p className="ant-upload-text">选择文件并生成取件码</p>
          <p className="ant-upload-hint">文件不会出现在公共列表中，仅凭取件码领取，到期自动删除</p>
        </Upload.Dragger>
        {pendingFile ? (
          <Alert
            type="info"
            showIcon
            style={{ marginTop: 10 }}
            message={`已选择：${pendingFile.name}（${formatBytes(pendingFile.size)}）`}
            description="确认无误后点击「生成取件码」；文件对外不可见，仅凭取件码领取。"
          />
        ) : null}
        <Button
          type="primary"
          block
          icon={<QrcodeOutlined />}
          loading={uploading}
          disabled={!pendingFile}
          style={{ marginTop: 10 }}
          onClick={() => void submit()}
        >
          生成取件码
        </Button>
        {uploading ? <Alert type="info" showIcon style={{ marginTop: 10 }} message="正在上传…" /> : null}
      </Card>

      <Modal
        open={Boolean(result)}
        title="取件码已生成"
        okText="复制取件码"
        cancelText="完成"
        onOk={async () => {
          if (result) {
            const ok = await copyText(result.code);
            message[ok ? 'success' : 'error'](ok ? '已复制' : '复制失败，请手动复制');
          }
        }}
        onCancel={() => setResult(null)}
        zIndex={1100}
      >
        {result ? (
          <div className="stack" style={{ gap: 12, textAlign: 'center' }}>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              请将取件码告知对方，仅展示一次：
            </Typography.Paragraph>
            <div
              style={{
                fontSize: 34,
                fontWeight: 700,
                letterSpacing: 8,
                fontFamily: 'monospace',
                color: '#0078d4',
                userSelect: 'all',
              }}
            >
              {result.code}
            </div>
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label="文件">{result.filename}</Descriptions.Item>
              <Descriptions.Item label="大小">{formatBytes(result.sizeBytes)}</Descriptions.Item>
              <Descriptions.Item label="到期时间">{formatDate(result.expiresAt)}</Descriptions.Item>
              <Descriptions.Item label="下载限制">
                {result.maxDownloads ? `最多 ${result.maxDownloads} 次` : '不限次数'}
              </Descriptions.Item>
            </Descriptions>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12.5, marginBottom: 0 }}>
              对方在「取件」页面输入取件码即可下载。到期或管理员撤销后自动删除。
            </Typography.Paragraph>
          </div>
        ) : null}
      </Modal>

      <div className="muted" style={{ fontSize: 12.5 }}>
        <CopyOutlined /> 上传成功后系统展示取件码；对方访问「取件」页输入即可下载。文件对其他人不可见。
      </div>
    </div>
  );
}

export function PublicZonePage() {
  const [tab, setTab] = useState('public');
  return (
    <>
      <div className="docs-hero">
        <div className="container">
          <h1>
            <CloudUploadOutlined style={{ color: '#0078d4', marginRight: 10 }} />
            文件共享区
          </h1>
          <p>公共区文件所有人可见、到期自动删除；私人传递凭取件码领取、对外不可见。</p>
        </div>
      </div>
      <div className="container section">
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            { key: 'public', label: '公共区', children: <PublicZoneTab /> },
            { key: 'share', label: '私人传递', children: <ShareTab /> },
          ]}
        />
      </div>
    </>
  );
}
