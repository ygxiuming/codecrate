import { useEffect, useState } from 'react';
import { Alert, Button, Form, Input } from 'antd';
import { CodeOutlined, LockOutlined, SafetyCertificateOutlined, UserOutlined } from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';

interface LoginValues {
  username: string;
  password: string;
}

export function AdminLoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void api
      .get('/api/auth/me')
      .then(() => navigate('/admin', { replace: true }))
      .catch(() => undefined);
  }, [navigate]);

  const submit = async (values: LoginValues): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      await api.post('/api/auth/login', values);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from.startsWith('/admin') ? from : '/admin', { replace: true });
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-layout">
      <aside className="login-aside">
        <div>
          <span className="brand" style={{ color: '#fff' }}>
            <span className="brand-mark">
              <CodeOutlined />
            </span>
            <span>
              CodeCrate 资源分发平台
              <small style={{ color: 'rgba(200,220,240,0.6)' }}>内网资源分发平台</small>
            </span>
          </span>
          <h1>把外网资源，安全地带进内网。</h1>
          <p>
            管理员在联网环境下采集软件安装包、VS Code 资源与文件，
            系统自动解析元数据、校验完整性并持久化存储，内网用户随取随用。
          </p>
          <div className="login-points">
            <span>
              <SafetyCertificateOutlined /> 后台会话隔离，所有敏感操作留审计日志
            </span>
            <span>
              <LockOutlined /> 下载链接基于资源 ID，防止路径遍历
            </span>
            <span>
              <CodeOutlined /> 支持批量缓存、断点续传与 SHA256 校验
            </span>
          </div>
        </div>
        <div style={{ color: 'rgba(180,208,235,0.5)', fontSize: 12 }}>
          仅限授权管理员访问 · 请勿在公网暴露管理后台
        </div>
      </aside>

      <main className="login-main">
        <div className="login-card">
          <h2>管理员登录</h2>
          <p className="login-sub">使用管理员账号进入缓存与存储管理控制台。</p>

          {error ? (
            <Alert type="error" showIcon message={error} style={{ marginBottom: 18 }} />
          ) : null}

          <Form<LoginValues> layout="vertical" onFinish={submit} requiredMark={false} size="large">
            <Form.Item
              label="用户名"
              name="username"
              rules={[{ required: true, message: '请输入用户名' }]}
            >
              <Input prefix={<UserOutlined style={{ color: '#8fa6bb' }} />} autoComplete="username" />
            </Form.Item>
            <Form.Item
              label="密码"
              name="password"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password
                prefix={<LockOutlined style={{ color: '#8fa6bb' }} />}
                autoComplete="current-password"
              />
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading} style={{ marginTop: 6 }}>
              登录管理后台
            </Button>
          </Form>

          <div className="login-foot">
            初始密码见部署日志或 <code>data/initial-admin-password</code>，登录后请立即修改。
          </div>
        </div>
      </main>
    </div>
  );
}
