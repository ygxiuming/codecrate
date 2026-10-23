import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Col,
  Descriptions,
  Divider,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Switch,
  Tabs,
  Tag,
  message,
} from 'antd';
import { ApiOutlined, LockOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { api } from '../../api/client';
import type { SettingsResponse } from '../../api/types';

interface TestResult {
  ok: boolean;
  latencyMs?: number;
  count?: number;
  sample?: unknown;
  error?: string;
  hint?: string;
  version?: string;
  commitHash?: string;
  filename?: string;
  sizeBytes?: number;
  provider?: string;
  total?: number;
}

export function SettingsPage() {
  const [form] = Form.useForm();
  const [passwordValues, setPasswordValues] = useState({ current: '', next: '', confirm: '' });
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [clearCode, setClearCode] = useState(false);

  const applyData = (result: SettingsResponse): void => {
    setData(result);
    const settings = result.settings;
    form.setFieldsValue({
      'site.name': settings['site.name'],
      'site.description': settings['site.description'],
      'cache.concurrency': settings['cache.concurrency'],
      'cache.max_attempts': settings['cache.max_attempts'],
      'download.max_concurrent_per_ip': settings['download.max_concurrent_per_ip'],
      uploadMb: Math.round(Number(settings['upload.max_bytes'] ?? 0) / (1024 * 1024)),
      uploadRemoteMb: Math.round(
        Number(settings['upload.remote_max_bytes'] ?? 0) / (1024 * 1024),
      ),
      softwareUploadMb: Math.round(
        Number(settings['upload.software_max_bytes'] ?? 0) / (1024 * 1024),
      ),
      'software.scan_interval_minutes': settings['software.scan_interval_minutes'],
      'comments.enabled': settings['comments.enabled'],
      'comments.mask_ip': settings['comments.mask_ip'],
      'public.enabled': settings['public.enabled'],
      publicMaxMb: Math.round(Number(settings['public.max_file_bytes'] ?? 0) / (1024 * 1024)),
      'public.retention_days': settings['public.retention_days'],
      publicBlocked: Array.isArray(settings['public.blocked_extensions'])
        ? (settings['public.blocked_extensions'] as string[]).join(',')
        : '',
      publicQuotaGb: Math.round(Number(settings['public.quota_bytes'] ?? 0) / (1024 * 1024 * 1024)),
      'share.enabled': settings['share.enabled'],
      'share.default_hours': settings['share.default_hours'],
      'share.max_hours': settings['share.max_hours'],
      'limits.upload_per_10min': settings['limits.upload_per_10min'],
      'limits.comment_per_min': settings['limits.comment_per_min'],
      'limits.redeem_per_15min': settings['limits.redeem_per_15min'],
      'marketplace.provider': settings['marketplace.provider'],
      'marketplace.official.endpoint': settings['marketplace.official.endpoint'],
      'marketplace.openvsx.endpoint': settings['marketplace.openvsx.endpoint'],
      'gallery.public_base_url': settings['gallery.public_base_url'],
      'sources.vscode.releases_url': settings['sources.vscode.releases_url'],
      'sources.vscode.download_base': settings['sources.vscode.download_base'],
      'sources.remote.download_base': settings['sources.remote.download_base'],
      'access.require_login': settings['access.require_login'],
      'access_log.enabled': settings['access_log.enabled'],
      'access_log.retention_days': settings['access_log.retention_days'],
      'access.code': '',
    });
  };

  const load = (): void => {
    setLoading(true);
    api
      .get<SettingsResponse>('/api/admin/settings')
      .then(applyData)
      .catch((error) => message.error((error as Error).message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async (): Promise<void> => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const payload: Record<string, unknown> = {
        'site.name': values['site.name'],
        'site.description': values['site.description'],
        'cache.concurrency': Number(values['cache.concurrency']),
        'cache.max_attempts': Number(values['cache.max_attempts']),
        'download.max_concurrent_per_ip': Number(values['download.max_concurrent_per_ip']),
        'upload.max_bytes': Math.round(Number(values.uploadMb) * 1024 * 1024),
        'upload.remote_max_bytes': Math.round(Number(values.uploadRemoteMb) * 1024 * 1024),
        'upload.software_max_bytes': Math.round(Number(values.softwareUploadMb) * 1024 * 1024),
        'software.scan_interval_minutes': Number(values['software.scan_interval_minutes']),
        'comments.enabled': Boolean(values['comments.enabled']),
        'comments.mask_ip': Boolean(values['comments.mask_ip']),
        'public.enabled': Boolean(values['public.enabled']),
        'public.max_file_bytes': Math.round(Number(values.publicMaxMb) * 1024 * 1024),
        'public.retention_days': Number(values['public.retention_days']),
        'public.blocked_extensions': String(values.publicBlocked ?? '')
          .split(',')
          .map((item) => item.trim().toLowerCase().replace(/^\./, ''))
          .filter(Boolean),
        'public.quota_bytes': Math.round(Number(values.publicQuotaGb) * 1024 * 1024 * 1024),
        'share.enabled': Boolean(values['share.enabled']),
        'share.default_hours': Number(values['share.default_hours']),
        'share.max_hours': Number(values['share.max_hours']),
        'limits.upload_per_10min': Number(values['limits.upload_per_10min']),
        'limits.comment_per_min': Number(values['limits.comment_per_min']),
        'limits.redeem_per_15min': Number(values['limits.redeem_per_15min']),
        'marketplace.provider': values['marketplace.provider'],
        'marketplace.official.endpoint': values['marketplace.official.endpoint'],
        'marketplace.openvsx.endpoint': values['marketplace.openvsx.endpoint'],
        'gallery.public_base_url': values['gallery.public_base_url'] ?? '',
        'sources.vscode.releases_url': values['sources.vscode.releases_url'],
        'sources.vscode.download_base': values['sources.vscode.download_base'],
        'sources.remote.download_base': values['sources.remote.download_base'],
        'access.require_login': Boolean(values['access.require_login']),
        'access_log.enabled': Boolean(values['access_log.enabled']),
        'access_log.retention_days': Number(values['access_log.retention_days']),
      };
      if (clearCode) payload['access.code'] = null;
      else if (values['access.code']) payload['access.code'] = values['access.code'];

      await api.put('/api/admin/settings', payload);
      setClearCode(false);
      message.success('设置已保存');
      load();
    } catch (error) {
      if ((error as { errorFields?: unknown }).errorFields) return;
      message.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const testSource = async (type: 'vscode' | 'official' | 'openvsx' | 'remote'): Promise<void> => {
    setTesting(type);
    try {
      const result = await api.post<TestResult>('/api/admin/settings/test-source', { type });
      setTestResults((current) => ({ ...current, [type]: result }));
    } catch (error) {
      setTestResults((current) => ({
        ...current,
        [type]: { ok: false, error: (error as Error).message },
      }));
    } finally {
      setTesting(null);
    }
  };

  const changePassword = async (): Promise<void> => {
    if (!passwordValues.current) {
      message.warning('请输入当前密码');
      return;
    }
    if (passwordValues.next.length < 10) {
      message.warning('新密码至少 10 位');
      return;
    }
    if (passwordValues.next !== passwordValues.confirm) {
      message.warning('两次输入的新密码不一致');
      return;
    }
    try {
      await api.post('/api/auth/password', {
        currentPassword: passwordValues.current,
        newPassword: passwordValues.next,
      });
      message.success('密码已修改，其他会话已失效');
      setPasswordValues({ current: '', next: '', confirm: '' });
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const resultAlert = (key: string, label: string) => {
    const result = testResults[key];
    if (!result) return null;
    return (
      <Alert
        style={{ marginTop: 8, borderRadius: 10 }}
        type={result.ok ? 'success' : 'error'}
        showIcon
        message={
          result.ok
            ? `${label}连接正常 · ${result.latencyMs ?? 0} ms`
            : `${label}连接失败`
        }
        description={
          result.ok ? (
            <span style={{ fontSize: 12 }}>
              {result.count !== undefined ? `版本数：${result.count}；` : ''}
              {result.total !== undefined ? `结果总数：${result.total}；` : ''}
              {result.version ? `版本：${result.version}；` : ''}
              {result.sizeBytes ? `示例大小：${(result.sizeBytes / 1024 / 1024).toFixed(1)} MB；` : ''}
              {result.sample ? `示例：${JSON.stringify(result.sample)}` : ''}
            </span>
          ) : (
            <div style={{ whiteSpace: 'pre-wrap', fontSize: 12.5 }}>
              {result.error}
              {result.hint ? <div style={{ marginTop: 8, color: '#8a5a00' }}>{result.hint}</div> : null}
            </div>
          )
        }
      />
    );
  };

  return (
    <div className="stack">
      <div className="row-between">
        <div className="page-title" style={{ marginBottom: 0 }}>
          <h2>系统设置</h2>
          <p>数据源、并发、上传限制与访问控制。保存后立即生效（访问日志保留期在每日维护任务运行时生效）。</p>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>
            重新加载
          </Button>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void save()}>
            保存设置
          </Button>
        </Space>
      </div>

      <div className="panel">
        <Form form={form} layout="vertical" requiredMark={false}>
          <Tabs
            items={[
              {
                key: 'basic',
                label: '基本设置',
                forceRender: true,
                children: (
                  <div>
                    <Row gutter={18}>
                      <Col xs={24} md={12}>
                        <Form.Item
                          name="site.name"
                          label="站点名称"
                          rules={[{ required: true, message: '请输入站点名称' }]}
                        >
                          <Input maxLength={80} />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={12}>
                        <Form.Item name="site.description" label="站点描述">
                          <Input maxLength={300} />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Divider orientation="left" plain>
                      性能与限制
                    </Divider>
                    <Row gutter={18}>
                      <Col xs={24} md={8}>
                        <Form.Item
                          name="cache.concurrency"
                          label="并发缓存任务数"
                          extra="同时下载的任务数量，建议 2–4"
                          rules={[{ required: true, message: '请填写并发数' }]}
                        >
                          <InputNumber min={1} max={16} style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={8}>
                        <Form.Item
                          name="cache.max_attempts"
                          label="单任务最大尝试次数"
                          rules={[{ required: true, message: '请填写重试次数' }]}
                        >
                          <InputNumber min={1} max={10} style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={8}>
                        <Form.Item
                          name="download.max_concurrent_per_ip"
                          label="单 IP 并发下载上限"
                          rules={[{ required: true, message: '请填写并发上限' }]}
                        >
                          <InputNumber min={1} max={64} style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={8}>
                        <Form.Item
                          name="uploadMb"
                          label="VSIX 上传上限"
                          extra="仅对 .vsix 上传生效"
                          rules={[{ required: true, message: '请填写上传上限' }]}
                        >
                          <InputNumber min={1} max={4096} addonAfter="MB" style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={8}>
                        <Form.Item
                          name="uploadRemoteMb"
                          label="Server 包上传上限"
                          extra="手动上传 Remote-SSH server 包时生效"
                          rules={[{ required: true, message: '请填写上传上限' }]}
                        >
                          <InputNumber min={1} max={4096} addonAfter="MB" style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                    </Row>
                  </div>
                ),
              },
              {
                key: 'sources',
                label: '数据源',
                forceRender: true,
                children: (
                  <div>
                    <Row gutter={18}>
                      <Col xs={24} md={12}>
                        <Form.Item name="marketplace.provider" label="默认插件市场源">
                          <Select
                            options={[
                              { value: 'official', label: '官方 Marketplace' },
                              { value: 'openvsx', label: 'Open VSX' },
                            ]}
                          />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Row gutter={18}>
                      <Col xs={24} md={12}>
                        <Form.Item
                          name="marketplace.official.endpoint"
                          label="官方 Marketplace 地址"
                          rules={[{ required: true, message: '请填写地址' }]}
                        >
                          <Input placeholder="https://marketplace.visualstudio.com" />
                        </Form.Item>
                        <Space style={{ marginTop: -12, marginBottom: 12 }}>
                          <Button
                            size="small"
                            icon={<ApiOutlined />}
                            loading={testing === 'official'}
                            onClick={() => void testSource('official')}
                          >
                            测试官方源
                          </Button>
                        </Space>
                        {resultAlert('official', '官方 Marketplace')}
                      </Col>
                      <Col xs={24} md={12}>
                        <Form.Item
                          name="marketplace.openvsx.endpoint"
                          label="Open VSX 地址"
                          rules={[{ required: true, message: '请填写地址' }]}
                        >
                          <Input placeholder="https://open-vsx.org" />
                        </Form.Item>
                        <Space style={{ marginTop: -12, marginBottom: 12 }}>
                          <Button
                            size="small"
                            icon={<ApiOutlined />}
                            loading={testing === 'openvsx'}
                            onClick={() => void testSource('openvsx')}
                          >
                            测试 Open VSX
                          </Button>
                        </Space>
                        {resultAlert('openvsx', 'Open VSX')}
                      </Col>
                    </Row>
                    <Row gutter={18}>
                      <Col xs={24} md={12}>
                        <Form.Item
                          name="gallery.public_base_url"
                          label="VS Code 接入外部地址（可选）"
                          extra="用于生成 VS Code product.json 中的 extensionsGallery 地址；留空则使用浏览器当前访问地址"
                        >
                          <Input placeholder="http://registry.corp.local" />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Divider orientation="left" plain>
                      VS Code 与 Remote-SSH
                    </Divider>
                    <Row gutter={18}>
                      <Col xs={24} md={12}>
                        <Form.Item
                          name="sources.vscode.releases_url"
                          label="版本列表 API"
                          rules={[{ required: true, message: '请填写地址' }]}
                        >
                          <Input placeholder="https://update.code.visualstudio.com/api/releases/stable" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={12}>
                        <Form.Item
                          name="sources.vscode.download_base"
                          label="安装包下载基础地址"
                          rules={[{ required: true, message: '请填写地址' }]}
                        >
                          <Input placeholder="https://update.code.visualstudio.com" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={12}>
                        <Form.Item
                          name="sources.remote.download_base"
                          label="Remote-SSH Server 镜像源地址"
                          extra="自动缓存时按 <镜像源>/commit:<commit>/server-<platform>/stable 下载；也可在 Remote-SSH 缓存页手动上传离线包"
                          rules={[{ required: true, message: '请填写地址' }]}
                        >
                          <Input placeholder="https://update.code.visualstudio.com" />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Space wrap>
                      <Button
                        size="small"
                        icon={<ApiOutlined />}
                        loading={testing === 'vscode'}
                        onClick={() => void testSource('vscode')}
                      >
                        测试版本源
                      </Button>
                      <Button
                        size="small"
                        icon={<ApiOutlined />}
                        loading={testing === 'remote'}
                        onClick={() => void testSource('remote')}
                      >
                        测试 Remote-SSH Server 源
                      </Button>
                    </Space>
                    {resultAlert('vscode', 'VS Code 版本源')}
                    {resultAlert('remote', 'Remote-SSH Server 源')}
                    <Alert
                      style={{ marginTop: 16, borderRadius: 10 }}
                      type="info"
                      showIcon
                      message="内网镜像需要显式放行"
                      description={
                        <span>
                          所有出网请求均经过 SSRF 防护，默认拒绝环回、私网与保留地址。若使用内网镜像，
                          请在部署时设置 <code>NETWORK_ALLOWED_PRIVATE_HOSTS</code>（当前：
                          {data?.info.allowedPrivateHosts.length
                            ? data.info.allowedPrivateHosts.join(', ')
                            : '空'}
                          ）。
                        </span>
                      }
                    />
                  </div>
                ),
              },
              {
                key: 'access',
                label: '访问与日志',
                forceRender: true,
                children: (
                  <div>
                    <Row gutter={18}>
                      <Col xs={24} md={12}>
                        <Form.Item
                          name="access.require_login"
                          label="前台需要访问码"
                          valuePropName="checked"
                          extra="开启后，浏览与下载都需要先输入共用访问码"
                        >
                          <Switch />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={12}>
                        <Form.Item
                          name="access.code"
                          label="设置访问码"
                          extra={
                            data?.accessCodeSet
                              ? '已设置访问码；留空表示不修改'
                              : '尚未设置访问码'
                          }
                        >
                          <Input.Password
                            prefix={<LockOutlined />}
                            placeholder="至少 4 位；保存后自动开启前台校验"
                            autoComplete="new-password"
                          />
                        </Form.Item>
                        <Checkbox
                          checked={clearCode}
                          onChange={(event) => setClearCode(event.target.checked)}
                          style={{ marginTop: -8, marginBottom: 12 }}
                        >
                          清除现有访问码
                        </Checkbox>
                      </Col>
                    </Row>
                    <Divider orientation="left" plain>
                      访问日志
                    </Divider>
                    <Row gutter={18}>
                      <Col xs={24} md={8}>
                        <Form.Item
                          name="access_log.enabled"
                          label="记录访问日志"
                          valuePropName="checked"
                          extra="包含页面浏览、点击、搜索与服务端下载"
                        >
                          <Switch />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={8}>
                        <Form.Item name="access_log.retention_days" label="保留期">
                          <Select
                            options={[
                              { value: 30, label: '30 天' },
                              { value: 90, label: '90 天（默认）' },
                              { value: 180, label: '180 天' },
                              { value: 0, label: '永久保留' },
                            ]}
                          />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Alert
                      type="warning"
                      showIcon
                      style={{ borderRadius: 10 }}
                      message="隐私提示"
                      description="访问日志默认记录完整 IPv4/IPv6，用于内网审计与资源运营。请根据组织制度告知使用者，并设置合理的保留期。修改保留期后，每日 03:00 的维护任务会清理超期数据。"
                    />
                  </div>
                ),
              },
              {
                key: 'zones',
                label: '软件包与文件区',
                forceRender: true,
                children: (
                  <div>
                    <Divider orientation="left" plain>
                      软件安装包
                    </Divider>
                    <Row gutter={18}>
                      <Col xs={24} md={8}>
                        <Form.Item
                          name="softwareUploadMb"
                          label="软件包上传上限"
                          extra="管理员上传任意软件安装包的大小上限"
                          rules={[{ required: true, message: '请填写上传上限' }]}
                        >
                          <InputNumber min={1} max={4096} addonAfter="MB" style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={8}>
                        <Form.Item
                          name="software.scan_interval_minutes"
                          label="目录自动扫描间隔"
                          extra="每 N 分钟扫描 data/files/software 目录；0 表示仅手动扫描"
                          rules={[{ required: true, message: '请填写扫描间隔' }]}
                        >
                          <InputNumber min={0} max={1440} addonAfter="分钟" style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Divider orientation="left" plain>
                      公共文件区
                    </Divider>
                    <Row gutter={18}>
                      <Col xs={24} md={8}>
                        <Form.Item
                          name="public.enabled"
                          label="启用公共文件区"
                          valuePropName="checked"
                          extra="关闭后用户无法上传与查看公共文件"
                        >
                          <Switch />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={8}>
                        <Form.Item
                          name="publicMaxMb"
                          label="单文件大小上限"
                          rules={[{ required: true, message: '请填写大小上限' }]}
                        >
                          <InputNumber min={1} max={4096} addonAfter="MB" style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={8}>
                        <Form.Item
                          name="public.retention_days"
                          label="默认保留天数"
                          extra="到期后系统自动删除文件"
                          rules={[{ required: true, message: '请填写保留天数' }]}
                        >
                          <InputNumber min={1} max={3650} addonAfter="天" style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={12}>
                        <Form.Item
                          name="publicBlocked"
                          label="扩展名黑名单（选填）"
                          extra="逗号分隔，例如 exe,msi,bat；留空表示不限制上传类型"
                        >
                          <Input placeholder="exe,msi" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={12}>
                        <Form.Item
                          name="publicQuotaGb"
                          label="文件区总配额"
                          extra="公共区与私人共享合计；0 表示不限制"
                          rules={[{ required: true, message: '请填写总配额' }]}
                        >
                          <InputNumber min={0} max={1024} addonAfter="GB" style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Divider orientation="left" plain>
                      私人传递（取件码）
                    </Divider>
                    <Row gutter={18}>
                      <Col xs={24} md={8}>
                        <Form.Item
                          name="share.enabled"
                          label="启用私人传递"
                          valuePropName="checked"
                          extra="关闭后用户无法创建新的取件"
                        >
                          <Switch />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={8}>
                        <Form.Item
                          name="share.default_hours"
                          label="默认有效期"
                          rules={[{ required: true, message: '请填写默认有效期' }]}
                        >
                          <InputNumber min={1} max={8760} addonAfter="小时" style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={8}>
                        <Form.Item
                          name="share.max_hours"
                          label="最长有效期"
                          rules={[{ required: true, message: '请填写最长有效期' }]}
                        >
                          <InputNumber min={1} max={8760} addonAfter="小时" style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Divider orientation="left" plain>
                      频率限制（0 = 不限）
                    </Divider>
                    <Row gutter={18}>
                      <Col xs={24} md={8}>
                        <Form.Item
                          name="limits.upload_per_10min"
                          label="文件上传"
                          extra="同一 IP 每 10 分钟可上传次数（公共区 + 私人传递）"
                          rules={[{ required: true, message: '请填写次数' }]}
                        >
                          <InputNumber min={0} max={10000} addonAfter="次" style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={8}>
                        <Form.Item
                          name="limits.comment_per_min"
                          label="发表评论"
                          extra="同一 IP 每分钟可发表次数"
                          rules={[{ required: true, message: '请填写次数' }]}
                        >
                          <InputNumber min={0} max={10000} addonAfter="次" style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={8}>
                        <Form.Item
                          name="limits.redeem_per_15min"
                          label="取件码兑换"
                          extra="同一 IP 每 15 分钟可兑换次数，防暴力猜测"
                          rules={[{ required: true, message: '请填写次数' }]}
                        >
                          <InputNumber min={0} max={10000} addonAfter="次" style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Divider orientation="left" plain>
                      评论区
                    </Divider>
                    <Row gutter={18}>
                      <Col xs={24} md={8}>
                        <Form.Item
                          name="comments.enabled"
                          label="启用评论区"
                          valuePropName="checked"
                          extra="包含全站留言板与软件包反馈"
                        >
                          <Switch />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={16}>
                        <Form.Item
                          name="comments.mask_ip"
                          label="评论 IP 脱敏"
                          valuePropName="checked"
                          extra="开启后评论中的 IPv4 显示为 192.168.*.*；关闭则完整显示"
                        >
                          <Switch />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Alert
                      type="info"
                      showIcon
                      style={{ borderRadius: 10 }}
                      message="公共区风险提示"
                      description="公共文件区默认不限上传类型，所有文件对全部用户可见。请根据内网管理要求设置黑名单、配额与保留期，过期文件由系统每 30 分钟自动清理一次。"
                    />
                  </div>
                ),
              },
              {
                key: 'password',
                label: '修改密码',
                forceRender: true,
                children: (
                  <div style={{ maxWidth: 420 }}>
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ marginBottom: 6 }}>当前密码</div>
                      <Input.Password
                        autoComplete="current-password"
                        value={passwordValues.current}
                        onChange={(event) =>
                          setPasswordValues((value) => ({ ...value, current: event.target.value }))
                        }
                      />
                    </div>
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ marginBottom: 6 }}>新密码</div>
                      <Input.Password
                        autoComplete="new-password"
                        value={passwordValues.next}
                        onChange={(event) =>
                          setPasswordValues((value) => ({ ...value, next: event.target.value }))
                        }
                        onPressEnter={(event) => {
                          event.preventDefault();
                          void changePassword();
                        }}
                      />
                    </div>
                    <div style={{ marginBottom: 18 }}>
                      <div style={{ marginBottom: 6 }}>确认新密码</div>
                      <Input.Password
                        autoComplete="new-password"
                        value={passwordValues.confirm}
                        onChange={(event) =>
                          setPasswordValues((value) => ({ ...value, confirm: event.target.value }))
                        }
                        onPressEnter={(event) => {
                          event.preventDefault();
                          void changePassword();
                        }}
                      />
                    </div>
                    <Button type="primary" onClick={() => void changePassword()}>
                      更新密码
                    </Button>
                    <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                      新密码至少 10 位；修改后其他管理会话将立即失效。
                    </div>
                  </div>
                ),
              },
              {
                key: 'info',
                label: '系统信息',
                children: data ? (
                  <Descriptions column={1} bordered size="small">
                    <Descriptions.Item label="版本">
                      <Tag color="blue">{data.info.version}</Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label="运行环境">{data.info.nodeEnv}</Descriptions.Item>
                    <Descriptions.Item label="数据目录">
                      <code>{data.info.dataDir}</code>
                    </Descriptions.Item>
                    <Descriptions.Item label="存储目录">
                      <code>{data.info.storageDir}</code>
                    </Descriptions.Item>
                    <Descriptions.Item label="数据库">
                      <code>{data.info.dbPath}</code>
                    </Descriptions.Item>
                    <Descriptions.Item label="前端目录">
                      <code>{data.info.webDist}</code>
                    </Descriptions.Item>
                    <Descriptions.Item label="管理会话有效期">
                      {data.info.sessionHours} 小时
                    </Descriptions.Item>
                    <Descriptions.Item label="内网放行主机">
                      {data.info.allowedPrivateHosts.length
                        ? data.info.allowedPrivateHosts.join(', ')
                        : '无'}
                    </Descriptions.Item>
                    <Descriptions.Item label="可用市场源">
                      {data.info.providers.map((provider) => provider.label).join(' / ')}
                    </Descriptions.Item>
                  </Descriptions>
                ) : (
                  <div>加载中…</div>
                ),
              },
            ]}
          />
        </Form>
      </div>
    </div>
  );
}
