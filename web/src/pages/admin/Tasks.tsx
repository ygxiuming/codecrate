import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Descriptions,
  Drawer,
  Popconfirm,
  Progress,
  Select,
  Table,
  Tag,
  Timeline,
  Tooltip,
  message,
} from 'antd';
import { ReloadOutlined, SyncOutlined } from '@ant-design/icons';
import type { TaskEvent, TaskRow } from '../../api/types';
import { api, qs } from '../../api/client';
import { formatBytes, formatDate } from '../../lib/format';
import { TASK_KIND_LABEL, TaskKindTag, TaskStatusTag, taskPercent } from '../../lib/labels';

export function TasksPage() {
  const [status, setStatus] = useState<string | undefined>();
  const [kind, setKind] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: TaskRow[]; total: number; page: number; pageSize: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<{ task: TaskRow; events: TaskEvent[] } | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(
    (silent = false) => {
      if (!silent) setLoading(true);
      api
        .get<{ items: TaskRow[]; total: number; page: number; pageSize: number }>(
          `/api/admin/tasks${qs({ status, kind, page, pageSize: 20 })}`,
        )
        .then(setData)
        .catch((error) => {
          if (!silent) message.error((error as Error).message);
        })
        .finally(() => {
          if (!silent) setLoading(false);
        });
    },
    [status, kind, page],
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) load(true);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [load]);

  const openDetail = async (id: number): Promise<void> => {
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const result = await api.get<{ task: TaskRow; events: TaskEvent[] }>(`/api/admin/tasks/${id}`);
      setDetail(result);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setDetailLoading(false);
    }
  };

  const retry = async (id: number): Promise<void> => {
    try {
      await api.post(`/api/admin/tasks/${id}/retry`);
      message.success('任务已重新排队');
      load(true);
      if (detailOpen) void openDetail(id);
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const cancel = async (id: number): Promise<void> => {
    try {
      await api.post(`/api/admin/tasks/${id}/cancel`);
      message.success('任务已取消');
      load(true);
      if (detailOpen) void openDetail(id);
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const retryAll = async (): Promise<void> => {
    try {
      const result = await api.post<{ retried: number }>('/api/admin/tasks/retry-failed');
      message.success(`已重新排队 ${result.retried} 个失败任务`);
      load(true);
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  return (
    <div className="stack">
      <div className="page-title">
        <h2>任务中心</h2>
        <p>
          缓存任务以「版本 × 平台」为单位。失败任务会自动退避重试；页面每 3 秒刷新一次状态。
        </p>
      </div>

      <div className="panel">
        <div className="toolbar-inline" style={{ marginBottom: 14 }}>
          <Select
            allowClear
            style={{ width: 150 }}
            placeholder="全部状态"
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            options={[
              { value: 'queued', label: '排队中' },
              { value: 'running', label: '下载中' },
              { value: 'success', label: '成功' },
              { value: 'failed', label: '失败' },
              { value: 'canceled', label: '已取消' },
            ]}
          />
          <Select
            allowClear
            style={{ width: 180 }}
            placeholder="全部类型"
            value={kind}
            onChange={(value) => {
              setKind(value);
              setPage(1);
            }}
            options={Object.entries(TASK_KIND_LABEL).map(([value, label]) => ({ value, label }))}
          />
          <Button icon={<ReloadOutlined />} onClick={() => load()}>
            刷新
          </Button>
          <Popconfirm
            title="重试全部失败任务？"
            description="最多一次重试 100 个失败任务，会保留已下载的分片。"
            okText="重试"
            cancelText="取消"
            onConfirm={() => void retryAll()}
          >
            <Button icon={<SyncOutlined />}>重试全部失败</Button>
          </Popconfirm>
          <Tag color="processing" style={{ marginLeft: 'auto', borderRadius: 999 }}>
            自动刷新中
          </Tag>
        </div>

        <Table<TaskRow>
          rowKey="id"
          size="middle"
          loading={loading}
          dataSource={data?.items ?? []}
          pagination={{
            current: data?.page ?? page,
            pageSize: data?.pageSize ?? 20,
            total: data?.total ?? 0,
            showSizeChanger: false,
            onChange: (nextPage) => setPage(nextPage),
          }}
          scroll={{ x: 1100 }}
          columns={[
            { title: 'ID', dataIndex: 'id', width: 70 },
            {
              title: '类型',
              dataIndex: 'kind',
              width: 150,
              render: (value: TaskRow['kind']) => <TaskKindTag kind={value} />,
            },
            {
              title: '目标',
              dataIndex: 'target_key',
              ellipsis: true,
              render: (value: string) => <span className="mono" style={{ fontSize: 11.5 }}>{value}</span>,
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 96,
              render: (value: TaskRow['status']) => <TaskStatusTag status={value} />,
            },
            {
              title: '进度',
              key: 'progress',
              width: 190,
              render: (_, row) => {
                const percent = taskPercent(row.progress_bytes, row.total_bytes, row.status);
                return (
                  <div>
                    <Progress
                      percent={percent}
                      size="small"
                      status={
                        row.status === 'failed'
                          ? 'exception'
                          : row.status === 'success'
                            ? 'success'
                            : row.status === 'running'
                              ? 'active'
                              : 'normal'
                      }
                      showInfo={false}
                    />
                    <div className="muted" style={{ fontSize: 11.5 }}>
                      {formatBytes(row.progress_bytes)} / {formatBytes(row.total_bytes)}
                    </div>
                  </div>
                );
              },
            },
            {
              title: '尝试',
              key: 'attempts',
              width: 80,
              render: (_, row) => `${row.attempts}/${row.max_attempts}`,
            },
            {
              title: '失败原因',
              dataIndex: 'error_message',
              width: 210,
              ellipsis: true,
              render: (value: string | null) =>
                value ? (
                  <Tooltip title={value}>
                    <span style={{ color: '#d92d20', fontSize: 12 }}>{value}</span>
                  </Tooltip>
                ) : (
                  <span className="muted">—</span>
                ),
            },
            {
              title: '创建时间',
              dataIndex: 'created_at',
              width: 150,
              render: (value: string) => (
                <span className="muted" style={{ fontSize: 12 }}>{formatDate(value)}</span>
              ),
            },
            {
              title: '操作',
              key: 'actions',
              width: 180,
              fixed: 'right',
              render: (_, row) => (
                <div className="toolbar-inline" style={{ gap: 4 }}>
                  <Button size="small" type="link" onClick={() => void openDetail(row.id)}>
                    详情
                  </Button>
                  {row.status === 'failed' || row.status === 'canceled' ? (
                    <Button size="small" type="link" onClick={() => void retry(row.id)}>
                      重试
                    </Button>
                  ) : null}
                  {row.status === 'queued' || row.status === 'running' ? (
                    <Popconfirm
                      title="取消该任务？"
                      okText="取消任务"
                      cancelText="保留"
                      onConfirm={() => void cancel(row.id)}
                    >
                      <Button size="small" type="link" danger>
                        取消
                      </Button>
                    </Popconfirm>
                  ) : null}
                </div>
              ),
            },
          ]}
          locale={{ emptyText: '暂无任务' }}
        />
      </div>

      <Drawer
        open={detailOpen}
        onClose={() => {
          setDetailOpen(false);
          setDetail(null);
        }}
        width={640}
        title={detail ? `任务 #${detail.task.id} · ${TASK_KIND_LABEL[detail.task.kind]}` : '任务详情'}
      >
        {detailLoading ? (
          <div>加载中…</div>
        ) : detail ? (
          <div className="stack">
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label="状态">
                <TaskStatusTag status={detail.task.status} />
              </Descriptions.Item>
              <Descriptions.Item label="尝试次数">
                {detail.task.attempts}/{detail.task.max_attempts}
              </Descriptions.Item>
              <Descriptions.Item label="目标" span={2}>
                <span className="mono" style={{ fontSize: 12 }}>{detail.task.target_key}</span>
              </Descriptions.Item>
              <Descriptions.Item label="进度" span={2}>
                {formatBytes(detail.task.progress_bytes)} / {formatBytes(detail.task.total_bytes)}
              </Descriptions.Item>
              <Descriptions.Item label="错误码">{detail.task.error_code ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="资源 ID">{detail.task.artifact_id ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="创建时间">{formatDate(detail.task.created_at)}</Descriptions.Item>
              <Descriptions.Item label="完成时间">{formatDate(detail.task.finished_at)}</Descriptions.Item>
              <Descriptions.Item label="错误信息" span={2}>
                {detail.task.error_message ?? '—'}
              </Descriptions.Item>
            </Descriptions>

            <div>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>任务事件</div>
              <Timeline
                items={detail.events.map((event) => ({
                  color:
                    event.level === 'error'
                      ? 'red'
                      : event.level === 'warn'
                        ? 'orange'
                        : event.level === 'success'
                          ? 'green'
                          : 'blue',
                  children: (
                    <div>
                      <div style={{ fontSize: 12.5 }}>{event.message}</div>
                      <div className="muted" style={{ fontSize: 11.5 }}>
                        {formatDate(event.created_at, 'YYYY-MM-DD HH:mm:ss')}
                      </div>
                    </div>
                  ),
                }))}
              />
            </div>

            <div>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>任务载荷</div>
              <pre
                className="mono"
                style={{
                  background: '#0c1b2a',
                  color: '#d7e7f7',
                  padding: 14,
                  borderRadius: 10,
                  fontSize: 11.5,
                  overflowX: 'auto',
                  margin: 0,
                }}
              >
                {JSON.stringify(detail.task.payload, null, 2)}
              </pre>
            </div>
          </div>
        ) : (
          <div>未找到任务</div>
        )}
      </Drawer>
    </div>
  );
}
