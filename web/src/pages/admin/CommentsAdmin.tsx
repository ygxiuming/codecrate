import { useCallback, useEffect, useState, type Key } from 'react';
import {
  Button,
  Input,
  Pagination,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  message,
} from 'antd';
import {
  PushpinFilled,
  PushpinOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { api, qs } from '../../api/client';
import type { AdminCommentRow } from '../../api/types';
import { formatDate, formatNumber } from '../../lib/format';

export function CommentsAdminPage() {
  const [data, setData] = useState<{ items: AdminCommentRow[]; total: number; page: number; pageSize: number } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [q, setQ] = useState('');
  const [targetType, setTargetType] = useState('');
  const [onlyPinned, setOnlyPinned] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedKeys, setSelectedKeys] = useState<Key[]>([]);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get<{ items: AdminCommentRow[]; total: number; page: number; pageSize: number }>(
        `/api/admin/comments${qs({ page, pageSize: 20, q, target_type: targetType || undefined, pinned: onlyPinned ? '1' : undefined })}`,
      )
      .then(setData)
      .catch((error) => message.error((error as Error).message))
      .finally(() => setLoading(false));
  }, [page, q, targetType, onlyPinned]);

  useEffect(() => {
    load();
  }, [load]);

  const togglePin = async (row: AdminCommentRow): Promise<void> => {
    try {
      await api.put(`/api/admin/comments/${row.id}/pin`, { pinned: !row.pinned });
      message.success(row.pinned ? '已取消置顶' : '已置顶');
      load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const remove = async (id: number): Promise<void> => {
    try {
      const result = await api.del<{ deleted: number }>(`/api/admin/comments/${id}`);
      message.success(result.deleted > 1 ? `已删除评论及其 ${result.deleted - 1} 条回复` : '已删除');
      load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const batchRemove = async (): Promise<void> => {
    const ids = selectedKeys.map(Number).filter((value) => Number.isFinite(value) && value > 0);
    if (ids.length === 0) return;
    try {
      const result = await api.post<{ deleted: number }>('/api/admin/comments/batch-delete', { ids });
      message.success(`已删除 ${result.deleted} 条（含回复）`);
      setSelectedKeys([]);
      load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  return (
    <div className="stack">
      <div className="page-title">
        <h2>评论管理</h2>
        <p>管理留言板与软件包反馈：置顶、删除（连带回复）、按 IP 或内容检索。</p>
      </div>

      <div className="panel">
        <div className="toolbar-inline" style={{ marginBottom: 14 }}>
          <Input
            allowClear
            style={{ width: 260 }}
            prefix={<SearchOutlined style={{ color: '#7c93a9' }} />}
            placeholder="搜索内容、昵称或 IP"
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
            style={{ width: 160 }}
            placeholder="全部来源"
            value={targetType || undefined}
            options={[
              { value: 'board', label: '留言板' },
              { value: 'software', label: '软件包' },
            ]}
            onChange={(value) => {
              setPage(1);
              setTargetType(value ?? '');
            }}
          />
          <Button
            type={onlyPinned ? 'primary' : 'default'}
            icon={<PushpinOutlined />}
            onClick={() => {
              setPage(1);
              setOnlyPinned((value) => !value);
            }}
          >
            只看置顶
          </Button>
          <Button icon={<ReloadOutlined />} onClick={load}>
            刷新
          </Button>
          {selectedKeys.length > 0 ? (
            <Popconfirm
              title={`批量删除选中的 ${selectedKeys.length} 条？`}
              description="顶层评论会连带删除其回复。"
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => void batchRemove()}
            >
              <Button danger>删除选中（{selectedKeys.length}）</Button>
            </Popconfirm>
          ) : null}
          <span className="muted" style={{ marginLeft: 'auto' }}>
            共 {formatNumber(data?.total ?? 0)} 条
          </span>
        </div>

        <Table<AdminCommentRow>
          rowKey="id"
          size="middle"
          loading={loading}
          dataSource={data?.items ?? []}
          pagination={false}
          rowSelection={{
            selectedRowKeys: selectedKeys,
            onChange: (keys) => setSelectedKeys(keys),
          }}
          expandable={{
            expandedRowRender: (row) => (
              <div style={{ fontSize: 12.5, wordBreak: 'break-all' }}>
                <span className="muted">User-Agent：</span>
                {row.userAgent || '—'}
              </div>
            ),
          }}
          columns={[
            {
              title: '内容',
              key: 'content',
              render: (_, row) => (
                <div>
                  <div style={{ wordBreak: 'break-word' }}>
                    {row.parentId ? (
                      <span className="muted" style={{ fontSize: 11.5, marginRight: 4 }}>
                        ↳{row.replyToNickname ? `回复 @${row.replyToNickname}` : '回复'}
                      </span>
                    ) : null}
                    {row.content}
                  </div>
                  <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                    {row.targetType === 'board' ? '留言板' : `软件包 #${row.targetId}`}
                    {row.replyCount > 0 ? ` · ${row.replyCount} 条回复` : ''}
                  </div>
                </div>
              ),
            },
            {
              title: '昵称',
              dataIndex: 'nickname',
              width: 110,
              render: (value: string) => value || <span className="muted">访客</span>,
            },
            {
              title: 'IP',
              dataIndex: 'ip',
              width: 150,
              render: (value: string, row) => (
                <Tooltip title={row.userAgent ? `UA：${row.userAgent}` : undefined}>
                  <span className="mono" style={{ fontSize: 12 }}>
                    {value || '—'}
                    {row.ipFamily === 'ipv6' ? ' (v6)' : ''}
                  </span>
                </Tooltip>
              ),
            },
            {
              title: '状态',
              key: 'pinned',
              width: 90,
              render: (_, row) =>
                row.pinned ? (
                  <Tag color="gold" style={{ borderRadius: 999 }}>
                    <PushpinFilled /> 置顶
                  </Tag>
                ) : (
                  <span className="muted" style={{ fontSize: 12 }}>—</span>
                ),
            },
            {
              title: '时间',
              dataIndex: 'createdAt',
              width: 145,
              render: (value: string) => (
                <span className="muted" style={{ fontSize: 12 }}>
                  {formatDate(value)}
                </span>
              ),
            },
            {
              title: '操作',
              key: 'actions',
              width: 150,
              render: (_, row) => (
                <Space>
                  {row.parentId === null ? (
                    <Button size="small" type="link" onClick={() => void togglePin(row)}>
                      {row.pinned ? '取消置顶' : '置顶'}
                    </Button>
                  ) : null}
                  <Popconfirm
                    title="删除该评论？"
                    description={row.replyCount > 0 ? `会连带删除 ${row.replyCount} 条回复。` : undefined}
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
          locale={{ emptyText: '暂无评论' }}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <Pagination
            current={data?.page ?? 1}
            pageSize={data?.pageSize ?? 20}
            total={data?.total ?? 0}
            showTotal={(total) => `共 ${total} 条`}
            onChange={setPage}
          />
        </div>
      </div>
    </div>
  );
}
