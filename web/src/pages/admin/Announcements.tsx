import { useEffect, useState } from 'react';
import {
  Button,
  DatePicker,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Switch,
  Table,
  Tag,
  message,
} from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { api } from '../../api/client';
import type { Announcement } from '../../api/types';
import { formatDate } from '../../lib/format';

const LEVEL_LABEL: Record<string, string> = {
  info: '通知',
  success: '成功',
  warning: '提醒',
  error: '重要',
};

const LEVEL_COLOR: Record<string, string> = {
  info: 'blue',
  success: 'green',
  warning: 'orange',
  error: 'red',
};

interface AnnouncementForm {
  title: string;
  content: string;
  level: Announcement['level'];
  pinned: boolean;
  published: boolean;
  range?: Array<Dayjs | null>;
}

function toPayload(row: Announcement): Record<string, unknown> {
  return {
    title: row.title,
    content: row.content,
    level: row.level,
    pinned: row.pinned,
    published: Boolean(row.published),
    startsAt: row.startsAt ?? null,
    endsAt: row.endsAt ?? null,
  };
}

export function AnnouncementsPage() {
  const [form] = Form.useForm<AnnouncementForm>();
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [saving, setSaving] = useState(false);

  const load = (): void => {
    setLoading(true);
    api
      .get<{ items: Announcement[] }>('/api/admin/announcements')
      .then((result) => setItems(result.items))
      .catch((error) => message.error((error as Error).message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = (): void => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      level: 'info',
      pinned: false,
      published: true,
      range: undefined,
    });
    setOpen(true);
  };

  const openEdit = (row: Announcement): void => {
    setEditing(row);
    form.setFieldsValue({
      title: row.title,
      content: row.content,
      level: row.level,
      pinned: row.pinned,
      published: Boolean(row.published),
      range:
        row.startsAt || row.endsAt
          ? [row.startsAt ? dayjs(row.startsAt) : null, row.endsAt ? dayjs(row.endsAt) : null]
          : undefined,
    });
    setOpen(true);
  };

  const save = async (): Promise<void> => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const payload = {
        title: values.title,
        content: values.content,
        level: values.level,
        pinned: Boolean(values.pinned),
        published: Boolean(values.published),
        startsAt: values.range?.[0]?.toISOString() ?? null,
        endsAt: values.range?.[1]?.toISOString() ?? null,
      };
      if (editing) {
        await api.put(`/api/admin/announcements/${editing.id}`, payload);
        message.success('公告已更新');
      } else {
        await api.post('/api/admin/announcements', payload);
        message.success('公告已创建');
      }
      setOpen(false);
      load();
    } catch (error) {
      if ((error as { errorFields?: unknown }).errorFields) return;
      message.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const togglePublished = async (row: Announcement): Promise<void> => {
    try {
      await api.put(`/api/admin/announcements/${row.id}`, {
        ...toPayload(row),
        published: !row.published,
      });
      message.success(row.published ? '公告已下线' : '公告已发布');
      load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const remove = async (id: number): Promise<void> => {
    try {
      await api.del(`/api/admin/announcements/${id}`);
      message.success('公告已删除');
      load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const effective = (row: Announcement): { label: string; color: string } => {
    if (!row.published) return { label: '草稿', color: 'default' };
    const now = Date.now();
    const starts = row.startsAt ? Date.parse(row.startsAt) : 0;
    const ends = row.endsAt ? Date.parse(row.endsAt) : Number.MAX_SAFE_INTEGER;
    if (starts > now) return { label: '待生效', color: 'gold' };
    if (ends < now) return { label: '已过期', color: 'default' };
    return { label: '已发布', color: 'green' };
  };

  return (
    <div className="stack">
      <div className="row-between">
        <div className="page-title" style={{ marginBottom: 0 }}>
          <h2>公告管理</h2>
          <p>发布后显示在前台顶部；支持置顶、生效时间与下线。内容按纯文本展示，保留换行。</p>
        </div>
        <div className="toolbar-inline">
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建公告
          </Button>
        </div>
      </div>

      <div className="panel">
        <Table<Announcement>
          rowKey="id"
          size="middle"
          loading={loading}
          dataSource={items}
          pagination={false}
          scroll={{ x: 980 }}
          columns={[
            {
              title: '公告',
              key: 'title',
              render: (_, row) => (
                <div style={{ maxWidth: 420 }}>
                  <div style={{ fontWeight: 600 }}>
                    {row.title}
                    {row.pinned ? (
                      <Tag color="gold" style={{ marginLeft: 8, borderRadius: 999 }}>
                        置顶
                      </Tag>
                    ) : null}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 3, whiteSpace: 'pre-wrap' }}>
                    {row.content.length > 80 ? `${row.content.slice(0, 80)}…` : row.content}
                  </div>
                </div>
              ),
            },
            {
              title: '级别',
              dataIndex: 'level',
              width: 90,
              render: (value: string) => (
                <Tag color={LEVEL_COLOR[value] ?? 'default'} style={{ borderRadius: 999 }}>
                  {LEVEL_LABEL[value] ?? value}
                </Tag>
              ),
            },
            {
              title: '状态',
              key: 'status',
              width: 90,
              render: (_, row) => {
                const state = effective(row);
                return (
                  <Tag color={state.color} style={{ borderRadius: 999 }}>
                    {state.label}
                  </Tag>
                );
              },
            },
            {
              title: '生效时间',
              key: 'schedule',
              width: 230,
              render: (_, row) => (
                <span className="muted" style={{ fontSize: 12 }}>
                  {row.startsAt ? formatDate(row.startsAt) : '立即'}
                  {' → '}
                  {row.endsAt ? formatDate(row.endsAt) : '长期'}
                </span>
              ),
            },
            {
              title: '更新时间',
              dataIndex: 'updatedAt',
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
              width: 210,
              render: (_, row) => (
                <div className="toolbar-inline" style={{ gap: 2 }}>
                  <Button size="small" type="link" onClick={() => openEdit(row)}>
                    编辑
                  </Button>
                  <Button size="small" type="link" onClick={() => void togglePublished(row)}>
                    {row.published ? '下线' : '发布'}
                  </Button>
                  <Popconfirm
                    title="删除该公告？"
                    description="删除后不可恢复，前台将立即移除。"
                    okText="删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => void remove(row.id)}
                  >
                    <Button size="small" type="link" danger>
                      删除
                    </Button>
                  </Popconfirm>
                </div>
              ),
            },
          ]}
          locale={{ emptyText: '还没有公告' }}
        />
      </div>

      <Modal
        open={open}
        title={editing ? '编辑公告' : '新建公告'}
        onCancel={() => setOpen(false)}
        onOk={() => void save()}
        okText={editing ? '保存修改' : '创建公告'}
        cancelText="取消"
        confirmLoading={saving}
        width={640}
      >
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item
            name="title"
            label="标题"
            rules={[{ required: true, message: '请填写标题' }]}
          >
            <Input maxLength={120} showCount placeholder="例如：本周六 22:00 内网源维护" />
          </Form.Item>
          <Form.Item
            name="content"
            label="内容"
            rules={[{ required: true, message: '请填写内容' }]}
          >
            <Input.TextArea
              rows={5}
              maxLength={5000}
              showCount
              placeholder="支持换行，前台按纯文本展示。"
            />
          </Form.Item>
          <div className="row-between" style={{ alignItems: 'flex-start', gap: 18 }}>
            <Form.Item name="level" label="级别" style={{ flex: 1 }}>
              <Select
                options={[
                  { value: 'info', label: '通知（蓝色）' },
                  { value: 'success', label: '成功（绿色）' },
                  { value: 'warning', label: '提醒（橙色）' },
                  { value: 'error', label: '重要（红色）' },
                ]}
              />
            </Form.Item>
            <Form.Item name="pinned" label="置顶" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="published" label="立即发布" valuePropName="checked">
              <Switch />
            </Form.Item>
          </div>
          <Form.Item
            name="range"
            label="生效时间（可选）"
            extra="留空表示立即生效 / 长期有效；可设置定时发布与自动过期。"
          >
            <DatePicker.RangePicker
              showTime
              allowEmpty={[true, true]}
              style={{ width: '100%' }}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
