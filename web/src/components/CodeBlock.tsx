import { useState } from 'react';
import { message, Tooltip } from 'antd';
import { CheckOutlined, CopyOutlined } from '@ant-design/icons';
import { copyText } from '../lib/format';
import { trackClick } from '../lib/tracker';

export function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async (): Promise<void> => {
    if (await copyText(code)) {
      setCopied(true);
      trackClick('copy_code');
      message.success('已复制');
      window.setTimeout(() => setCopied(false), 1600);
    }
  };

  return (
    <div className="code-block">
      <code>{code}</code>
      <Tooltip title={copied ? '已复制' : '复制'}>
        <button type="button" className="copy-code" onClick={() => void copy()} aria-label="复制代码">
          {copied ? <CheckOutlined /> : <CopyOutlined />}
        </button>
      </Tooltip>
    </div>
  );
}
