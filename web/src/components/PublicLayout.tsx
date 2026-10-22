import { useEffect, useState } from 'react';
import { Alert, Button, Input, Modal, Tag } from 'antd';
import {
  AppstoreOutlined,
  BookOutlined,
  CloudServerOutlined,
  CodeOutlined,
  GithubOutlined,
  HomeOutlined,
  LockOutlined,
  LoginOutlined,
  NotificationOutlined,
  SafetyCertificateOutlined,
  StarOutlined,
} from '@ant-design/icons';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { api } from '../api/client';
import type { Announcement, PublicConfig } from '../api/types';
import { PROJECT } from '../lib/project';
import { trackClick, trackPageView } from '../lib/tracker';

const NAV_ITEMS = [
  { to: '/', label: '首页', icon: <HomeOutlined /> },
  { to: '/vscode', label: 'VS Code 安装包', icon: <CodeOutlined /> },
  { to: '/extensions', label: '离线插件', icon: <AppstoreOutlined /> },
  { to: '/remote-ssh', label: 'Remote-SSH', icon: <CloudServerOutlined /> },
  { to: '/docs', label: '使用说明', icon: <BookOutlined /> },
];

function BrandMark() {
  return (
    <span className="brand-mark">
      <CodeOutlined />
    </span>
  );
}

function AccessGate({ onSuccess }: { onSuccess: () => void }) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (): Promise<void> => {
    if (!code.trim()) {
      setError('请输入访问码');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api.post('/api/access/login', { code });
      onSuccess();
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="gate-wrap">
      <div className="gate-card">
        <div className="gate-icon">
          <LockOutlined />
        </div>
        <h2>需要访问码</h2>
        <p>
          本站已开启访问校验。请输入管理员提供的共用访问码，验证后可浏览并下载离线资源。
        </p>
        <Input.Password
          size="large"
          placeholder="输入访问码"
          prefix={<SafetyCertificateOutlined />}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          onPressEnter={() => void submit()}
          status={error ? 'error' : undefined}
        />
        {error ? (
          <div style={{ color: '#d92d20', fontSize: 12.5, marginTop: 8, textAlign: 'left' }}>
            {error}
          </div>
        ) : null}
        <Button
          type="primary"
          size="large"
          block
          loading={loading}
          style={{ marginTop: 18 }}
          onClick={() => void submit()}
        >
          进入资源库
        </Button>
        <div style={{ marginTop: 14, color: '#8497a9', fontSize: 12 }}>
          访问码由内网管理员统一发放，请勿外传。
        </div>
      </div>
    </div>
  );
}

export function PublicLayout() {
  const location = useLocation();
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [access, setAccess] = useState<{ required: boolean; authenticated: boolean } | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('vr_dismissed_announcements') ?? '[]') as string[]);
    } catch {
      return new Set<string>();
    }
  });

  useEffect(() => {
    void api
      .get<PublicConfig>('/api/public/config')
      .then(setConfig)
      .catch(() => undefined);
    void api
      .get<{ required: boolean; authenticated: boolean }>('/api/access/status')
      .then(setAccess)
      .catch(() => setAccess({ required: false, authenticated: true }));
    void api
      .get<{ items: Announcement[] }>('/api/public/announcements')
      .then((result) => setAnnouncements(result.items))
      .catch(() => undefined);
  }, []);

  const dismissAnnouncements = (items: Announcement[]): void => {
    if (items.length === 0) return;
    for (const announcement of items) {
      trackClick('dismiss_announcement', { metadata: { id: announcement.id } });
    }
    setDismissed((current) => {
      const next = new Set(current);
      for (const announcement of items) {
        next.add(`${announcement.id}:${announcement.updatedAt ?? ''}`);
      }
      localStorage.setItem('vr_dismissed_announcements', JSON.stringify([...next].slice(-100)));
      return next;
    });
  };

  const visibleAnnouncements = announcements
    .filter((item) => !dismissed.has(`${item.id}:${item.updatedAt ?? ''}`))
    .slice(0, 5);

  useEffect(() => {
    trackPageView(location.pathname);
    window.scrollTo(0, 0);
  }, [location.pathname]);

  useEffect(() => {
    const handler = (): void => {
      setAccess({ required: true, authenticated: false });
    };
    window.addEventListener('access-required', handler);
    return () => window.removeEventListener('access-required', handler);
  }, []);

  const siteName = config?.siteName ?? 'CodeCrate 离线部署源';
  const locked = Boolean(access?.required && !access?.authenticated);

  return (
    <div>
      <header className="public-header">
        <div className="container public-header-inner">
          <Link to="/" className="brand" aria-label={siteName}>
            <BrandMark />
            <span>
              {siteName}
              <small>内网离线分发平台</small>
            </span>
          </Link>
          <nav className="public-nav">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
              >
                {item.icon}
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="header-actions">
            <a
              href={PROJECT.repoUrl}
              className="nav-link github-entry"
              target="_blank"
              rel="noopener noreferrer"
              title="查看 CodeCrate 源码与更新"
            >
              <GithubOutlined />
              <span>GitHub</span>
            </a>
            <Link to="/admin/login" className="nav-link admin-entry">
              <LoginOutlined />
              <span>管理登录</span>
            </Link>
            <Tag color="blue" style={{ marginInlineEnd: 0, borderRadius: 999 }}>
              <span className="header-meta" style={{ color: 'inherit' }}>
                纯内网可用
              </span>
            </Tag>
          </div>
        </div>
      </header>

      {locked ? (
        <AccessGate onSuccess={() => window.location.reload()} />
      ) : (
        <main>
          <Outlet />
        </main>
      )}

      <Modal
        open={!locked && access !== null && visibleAnnouncements.length > 0}
        title={
          <span>
            <NotificationOutlined style={{ color: '#0078d4', marginRight: 8 }} />
            站点公告
          </span>
        }
        width={560}
        centered
        onCancel={() => dismissAnnouncements(visibleAnnouncements)}
        footer={
          <Button type="primary" onClick={() => dismissAnnouncements(visibleAnnouncements)}>
            我知道了
          </Button>
        }
      >
        <div style={{ display: 'grid', gap: 12, marginTop: 8 }}>
          {visibleAnnouncements.map((announcement) => (
            <Alert
              key={`${announcement.id}:${announcement.updatedAt ?? ''}`}
              type={announcement.level}
              showIcon
              message={
                <span>
                  {announcement.title}
                  {announcement.pinned ? (
                    <Tag color="blue" style={{ marginLeft: 8, borderRadius: 999 }}>
                      置顶
                    </Tag>
                  ) : null}
                </span>
              }
              description={
                <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8 }}>
                  {announcement.content}
                </div>
              }
            />
          ))}
        </div>
      </Modal>

      <footer className="public-footer">
        <div className="container public-footer-inner">
          <div className="public-footer-meta">
            <strong style={{ color: '#425466' }}>{siteName}</strong>
            <span>
              离线资源仅限内网使用，请勿将下载文件外传 · 基于开源项目{' '}
              <a href={PROJECT.repoUrl} target="_blank" rel="noopener noreferrer">
                CodeCrate
              </a>{' '}
              ({PROJECT.license})
            </span>
          </div>
          <div className="public-footer-links">
            <Link to="/docs">使用说明</Link>
            <Link to="/docs?tab=remote-ssh">Remote-SSH 配置</Link>
            <Link to="/docs?tab=faq">常见问题</Link>
            <a href={PROJECT.issuesUrl} target="_blank" rel="noopener noreferrer">
              问题反馈
            </a>
            <a
              href={PROJECT.repoUrl}
              className="footer-star"
              target="_blank"
              rel="noopener noreferrer"
            >
              <StarOutlined /> Star
            </a>
            <span>v{config?.version ?? '1.0.0'}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
