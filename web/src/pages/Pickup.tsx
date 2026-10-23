import { useState } from 'react';
import { Alert, Button, Card, Input, Result, Space, Typography } from 'antd';
import { QrcodeOutlined, ReloadOutlined, SendOutlined } from '@ant-design/icons';
import { api } from '../api/client';
import type { ShareRedeemResult } from '../api/types';
import { formatBytes, formatDate } from '../lib/format';

export function PickupPage() {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ShareRedeemResult | null>(null);

  const redeem = async (): Promise<void> => {
    const value = code.trim().toUpperCase();
    if (!value) {
      setError('请输入取件码');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await api.post<ShareRedeemResult>('/api/share/redeem', { code: value });
      setResult(data);
    } catch (redeemError) {
      setError((redeemError as Error).message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const reset = (): void => {
    setResult(null);
    setCode('');
    setError('');
  };

  return (
    <div className="container section" style={{ maxWidth: 620 }}>
      <Card>
        <Result
          icon={<QrcodeOutlined style={{ color: '#0078d4' }} />}
          title="取件中心"
          subTitle="输入对方提供的取件码，即可在有效期内下载文件。无需登录，取件码即凭证。"
        >
          {result ? (
            <div className="stack" style={{ gap: 14, textAlign: 'left' }}>
              <Alert
                type="success"
                showIcon
                message="取件成功"
                description={`下载链接 15 分钟内有效，过期后需重新取件。文件将于 ${formatDate(result.expiresAt)} 过期。`}
              />
              <div className="zone-file-item">
                <div className="row-between">
                  <strong style={{ wordBreak: 'break-all' }}>{result.filename}</strong>
                </div>
                <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
                  {formatBytes(result.sizeBytes)} · 到期时间 {formatDate(result.expiresAt)}
                </div>
                {result.note ? (
                  <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                    备注：{result.note}
                  </div>
                ) : null}
                <div style={{ marginTop: 4 }}>
                  <span className="muted" style={{ fontSize: 12 }}>
                    SHA256 {result.sha256.slice(0, 24)}…
                  </span>
                </div>
                <Space style={{ marginTop: 12 }} wrap>
                  <Button
                    type="primary"
                    icon={<SendOutlined />}
                    onClick={() => {
                      window.location.href = result.downloadUrl;
                    }}
                  >
                    下载文件
                  </Button>
                  <Button icon={<ReloadOutlined />} onClick={reset}>
                    继续取件
                  </Button>
                </Space>
              </div>
              <Typography.Paragraph type="secondary" style={{ fontSize: 12.5, marginBottom: 0 }}>
                提示：下载采用断点续传；请使用浏览器直接打开下载链接。
              </Typography.Paragraph>
            </div>
          ) : (
            <div className="stack" style={{ gap: 12, textAlign: 'left' }}>
              <Input
                size="large"
                placeholder="输入 8 位取件码"
                prefix={<QrcodeOutlined style={{ color: '#7c93a9' }} />}
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                onPressEnter={() => void redeem()}
                maxLength={16}
                status={error ? 'error' : undefined}
                style={{ fontFamily: 'monospace', letterSpacing: 2 }}
              />
              {error ? (
                <div style={{ color: '#d92d20', fontSize: 12.5 }}>{error}</div>
              ) : null}
              <Button
                type="primary"
                size="large"
                block
                loading={loading}
                onClick={() => void redeem()}
              >
                取件
              </Button>
              <Typography.Paragraph type="secondary" style={{ fontSize: 12.5, marginBottom: 0 }}>
                取件码由分享者在「公共区 → 私人传递」生成；连续错误会被暂时限制。
              </Typography.Paragraph>
            </div>
          )}
        </Result>
      </Card>
    </div>
  );
}
