import { useCallback, useEffect, useState } from 'react';
import { Avatar, Button, Empty, Input, Pagination, Spin, Tag } from 'antd';
import { MessageOutlined, PushpinOutlined, SendOutlined } from '@ant-design/icons';
import { api, qs } from '../api/client';
import type { CommentListResponse, CommentThread } from '../api/types';
import { copyText, formatDate } from '../lib/format';

export type CommentTargetType = 'board' | 'software';

interface ReplyState {
  threadId: number;
  replyToId?: number;
  replyToNickname?: string;
}

function displayIp(ip: string, family: string | null, mask: boolean): string {
  if (mask) {
    const parts = ip.split('.');
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.*.*`;
    return '已脱敏';
  }
  if (family === 'ipv6') return 'IPv6 用户';
  return ip || '未知';
}

function CommentMeta({
  ip,
  family,
  mask,
}: {
  ip: string;
  family: string | null;
  mask: boolean;
}) {
  const text = displayIp(ip, family, mask);
  const masked = mask || family === 'ipv6';
  return (
    <button
      type="button"
      className="comment-ip"
      title={masked ? text : `点击复制 IP ${ip}`}
      onClick={() => {
        if (!masked) void copyText(ip);
      }}
    >
      {text}
    </button>
  );
}

interface Props {
  targetType: CommentTargetType;
  targetId: number;
  title?: string;
  description?: string;
  /** wide 屏幕下顶层留言按多列网格排布（留言板页使用） */
  columns?: 1 | 2;
}

export function CommentSection({ targetType, targetId, title = '评论区', description, columns = 1 }: Props) {
  const [data, setData] = useState<CommentListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [nickname, setNickname] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [reply, setReply] = useState<ReplyState | null>(null);
  const [replyContent, setReplyContent] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(
    (nextPage = page, nextSize = pageSize) => {
      setLoading(true);
      api
        .get<CommentListResponse>(
          `/api/public/comments${qs({ target_type: targetType, target_id: targetType === 'software' ? targetId : undefined, page: nextPage, pageSize: nextSize })}`,
        )
        .then(setData)
        .catch(() => setData(null))
        .finally(() => setLoading(false));
    },
    [targetType, targetId, page, pageSize],
  );

  useEffect(() => {
    load(page, pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetType, targetId, page, pageSize]);

  const submit = async (): Promise<void> => {
    const text = content.trim();
    if (!text) {
      setError('请输入评论内容');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await api.post('/api/public/comments', {
        target_type: targetType,
        target_id: targetType === 'software' ? targetId : undefined,
        content: text,
        nickname: nickname.trim() || undefined,
      });
      setContent('');
      setPage(1);
      load(1);
    } catch (submitError) {
      setError((submitError as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const submitReply = async (): Promise<void> => {
    if (!reply) return;
    const text = replyContent.trim();
    if (!text) {
      setError('请输入回复内容');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await api.post('/api/public/comments', {
        target_type: targetType,
        target_id: targetType === 'software' ? targetId : undefined,
        content: text,
        nickname: nickname.trim() || undefined,
        parent_id: reply.threadId,
        reply_to_id: reply.replyToId,
      });
      setReply(null);
      setReplyContent('');
      load();
    } catch (replyError) {
      setError((replyError as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const mask = data?.maskIp ?? false;

  const renderReplyForm = (thread: CommentThread, replyTo?: ReplyState): JSX.Element => (
    <div className="comment-reply-form">
      {replyTo?.replyToNickname ? (
        <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
          回复 @{replyTo.replyToNickname}
          <Button
            type="link"
            size="small"
            onClick={() => setReply({ threadId: thread.id })}
            style={{ padding: 0, marginLeft: 6 }}
          >
            取消指定
          </Button>
        </div>
      ) : null}
      <Input.TextArea
        rows={2}
        placeholder={`回复 @${replyTo?.replyToNickname || '匿名'}…`}
        value={replyContent}
        onChange={(event) => setReplyContent(event.target.value)}
        maxLength={1000}
        showCount
      />
      <div className="row-between" style={{ marginTop: 6 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          发布后将自动展示你的内网 IPv4
        </span>
        <Button
          size="small"
          type="primary"
          icon={<SendOutlined />}
          loading={submitting}
          onClick={() => void submitReply()}
        >
          回复
        </Button>
      </div>
    </div>
  );

  return (
    <div className="panel" style={{ padding: 18 }}>
      <div className="row-between" style={{ marginBottom: 4 }}>
        <strong style={{ fontSize: 15 }}>
          <MessageOutlined style={{ color: '#0078d4', marginRight: 8 }} />
          {title}
        </strong>
        <span className="muted" style={{ fontSize: 12 }}>
          共 {data?.total ?? 0} 条
        </span>
      </div>
      {description ? (
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
          {description}
        </div>
      ) : null}

      <div style={{ margin: '10px 0 4px' }}>
        <Input
          placeholder="昵称（选填，默认显示「访客」）"
          value={nickname}
          onChange={(event) => setNickname(event.target.value)}
          maxLength={30}
          style={{ marginBottom: 8 }}
        />
        <Input.TextArea
          rows={3}
          placeholder="说点什么吧…（发布后自动展示内网 IPv4）"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          maxLength={1000}
          showCount
        />
        <div className="row-between" style={{ marginTop: 8 }}>
          <span style={{ color: '#d92d20', fontSize: 12.5 }}>{error}</span>
          <Button
            type="primary"
            icon={<SendOutlined />}
            loading={submitting}
            onClick={() => void submit()}
          >
            发表评论
          </Button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <Spin />
        </div>
      ) : data && data.items.length > 0 ? (
        <div className={`comment-list${columns === 2 ? ' comment-grid' : ''}`}>
          {data.items.map((thread) => (
            <div key={thread.id} className="comment-item">
              <div className="comment-head">
                <Avatar size={30} style={{ background: '#0078d4', fontSize: 13 }}>
                  {(thread.nickname || '访客').slice(0, 1).toUpperCase()}
                </Avatar>
                <strong style={{ fontSize: 13.5 }}>{thread.nickname || '访客'}</strong>
                {thread.pinned ? (
                  <Tag color="gold" style={{ borderRadius: 999, marginInlineEnd: 0 }}>
                    <PushpinOutlined /> 置顶
                  </Tag>
                ) : null}
                <CommentMeta ip={thread.ip} family={thread.ipFamily} mask={mask} />
                <span className="muted" style={{ fontSize: 12 }}>
                  {formatDate(thread.createdAt)}
                </span>
              </div>
              <div className="comment-body">{thread.content}</div>
              <div className="comment-actions">
                <Button
                  type="link"
                  size="small"
                  style={{ padding: 0 }}
                  onClick={() => {
                    setReply({ threadId: thread.id });
                    setReplyContent('');
                  }}
                >
                  回复（{thread.replies.length}）
                </Button>
              </div>

              {thread.replies.length > 0 ? (
                <div className="comment-replies">
                  {thread.replies.map((item) => (
                    <div key={item.id} className="comment-reply">
                      <div className="comment-head">
                        <strong style={{ fontSize: 12.5 }}>{item.nickname || '访客'}</strong>
                        {item.replyToNickname ? (
                          <span className="muted" style={{ fontSize: 12 }}>
                            回复 @{item.replyToNickname}
                          </span>
                        ) : null}
                        <CommentMeta ip={item.ip} family={item.ipFamily} mask={mask} />
                        <span className="muted" style={{ fontSize: 12 }}>
                          {formatDate(item.createdAt)}
                        </span>
                      </div>
                      <div className="comment-body" style={{ fontSize: 13 }}>
                        {item.content}
                      </div>
                      <div className="comment-actions">
                        <Button
                          type="link"
                          size="small"
                          style={{ padding: 0, fontSize: 12 }}
                          onClick={() => {
                            setReply({
                              threadId: thread.id,
                              replyToId: item.id,
                              replyToNickname: item.nickname,
                            });
                            setReplyContent('');
                          }}
                        >
                          回复
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {reply?.threadId === thread.id ? (
                <div style={{ marginTop: 8 }}>
                  {renderReplyForm(thread, reply)}
                </div>
              ) : null}
            </div>
          ))}
          {data.total > 0 ? (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
              <Pagination
                current={data.page}
                pageSize={data.pageSize}
                total={data.total}
                showSizeChanger
                pageSizeOptions={[10, 20, 50]}
                showTotal={(total) => `共 ${total} 条`}
                onChange={(nextPage, nextSize) => {
                  setPage(nextPage);
                  setPageSize(nextSize);
                }}
              />
            </div>
          ) : null}
        </div>
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="还没有评论，来抢沙发"
          style={{ margin: '16px 0' }}
        />
      )}
    </div>
  );
}
