import { useEffect, useMemo, useState } from 'react';
import { Avatar, Button, Layout, Menu, Spin, Tooltip } from 'antd';
import {
  AppstoreOutlined,
  CloudServerOutlined,
  CodeOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  FileSearchOutlined,
  HistoryOutlined,
  LineChartOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  NotificationOutlined,
  SettingOutlined,
  ShopOutlined,
} from '@ant-design/icons';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client';

const { Sider, Header, Content } = Layout;

const MENU = [
  { key: '/admin', label: '概览', icon: <DashboardOutlined /> },
  { key: '/admin/announcements', label: '公告管理', icon: <NotificationOutlined /> },
  { key: '/admin/vscode', label: 'VS Code 缓存', icon: <CodeOutlined /> },
  { key: '/admin/extensions', label: '插件管理', icon: <AppstoreOutlined /> },
  { key: '/admin/marketplace', label: '市场浏览', icon: <ShopOutlined /> },
  { key: '/admin/remote', label: 'Remote-SSH 缓存', icon: <CloudServerOutlined /> },
  { key: '/admin/tasks', label: '任务中心', icon: <HistoryOutlined /> },
  { key: '/admin/storage', label: '存储管理', icon: <DatabaseOutlined /> },
  { key: '/admin/analytics', label: '访问分析', icon: <LineChartOutlined /> },
  { key: '/admin/logs', label: '日志审计', icon: <FileSearchOutlined /> },
  { key: '/admin/settings', label: '系统设置', icon: <SettingOutlined /> },
];

export function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState('');
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .get<{ admin: { id: number; username: string } }>('/api/auth/me')
      .then((data) => {
        if (!active) return;
        setUsername(data.admin.username);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        navigate('/admin/login', { replace: true, state: { from: location.pathname } });
      });
    return () => {
      active = false;
    };
  }, [navigate, location.pathname]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  const selected = useMemo(() => {
    const matches = MENU.filter(
      (item) => item.key === '/admin' || location.pathname.startsWith(item.key),
    ).sort((a, b) => b.key.length - a.key.length);
    return [matches[0]?.key ?? '/admin'];
  }, [location.pathname]);

  const current = MENU.find((item) => item.key === selected[0])?.label ?? '概览';

  const logout = async (): Promise<void> => {
    try {
      await api.post('/api/auth/logout');
    } catch {
      // 忽略退出时的网络错误
    }
    navigate('/admin/login', { replace: true });
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <Spin size="large" tip="正在验证管理会话…" />
      </div>
    );
  }

  return (
    <Layout className="admin-root">
      <Sider
        className="admin-sider"
        width={236}
        collapsedWidth={0}
        collapsible
        collapsed={collapsed}
        trigger={null}
        breakpoint="lg"
        onBreakpoint={(broken) => setCollapsed(broken)}
      >
        <Link to="/admin" className="admin-brand">
          <span className="brand-mark">
            <CodeOutlined />
          </span>
          <span>
            <strong>离线部署源</strong>
            <small>管理控制台</small>
          </span>
        </Link>
        <Menu
          className="admin-menu"
          theme="dark"
          mode="inline"
          items={MENU.map((item) => ({
            key: item.key,
            icon: item.icon,
            label: item.label,
          }))}
          selectedKeys={selected}
          onClick={({ key }) => {
            navigate(key);
            if (window.innerWidth < 992) setCollapsed(true);
          }}
        />
        <div className="sider-foot">v1.0.0 · 内网离线分发</div>
      </Sider>

      <Layout>
        <Header className="admin-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Button
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed((value) => !value)}
              aria-label="切换导航"
            />
            <div>
              <h1>{current}</h1>
              <div className="crumb">管理后台 / {current}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Link to="/" className="nav-link" style={{ fontSize: 13 }}>
              返回前台
            </Link>
            <Avatar size={30} style={{ background: '#0078d4' }}>
              {username.slice(0, 1).toUpperCase()}
            </Avatar>
            <span style={{ fontSize: 13, color: '#425466' }}>{username}</span>
            <Tooltip title="退出登录">
              <Button type="text" icon={<LogoutOutlined />} onClick={() => void logout()} />
            </Tooltip>
          </div>
        </Header>
        <Content className="admin-content">
          <div className="admin-page">
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
