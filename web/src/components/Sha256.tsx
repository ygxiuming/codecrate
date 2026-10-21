import { useState } from 'react';
import { message, Tooltip } from 'antd';
import { CheckOutlined, CopyOutlined } from '@ant-design/icons';
import { copyText, shortSha } from '../lib/format';
import { trackClick } from '../lib/tracker';

interface Props {
  value: string;
  length?: number;
  compact?: boolean;
}

export function Sha256({ value, length = 16, compact = true }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = async (): Promise<void> => {
    const ok = await copyText(value);
    if (ok) {
      setCopied(true);
      trackClick('copy_sha256');
      message.success('SHA256 已复制');
      window.setTimeout(() => setCopied(false), 1600);
    } else {
      message.error('复制失败，请手动选择');
    }
  };

  return (
    <span className="sha">
      <code title={value}>{compact ? shortSha(value, length) : value}</code>
      <Tooltip title={copied ? '已复制' : '复制完整 SHA256'}>
        <button type="button" className="copy-btn" onClick={() => void copy()} aria-label="复制 SHA256">
          {copied ? <CheckOutlined /> : <CopyOutlined />}
        </button>
      </Tooltip>
    </span>
  );
}
