import type { MouseEvent } from 'react';
import { Button } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { trackClick } from '../lib/tracker';

type ResourceType = 'vscode' | 'extension' | 'remote-server' | 'software' | 'public_file';

interface Props {
  resourceType: ResourceType;
  artifactId: number;
  filename: string;
  label?: string;
  buttonType?: 'primary' | 'default' | 'dashed' | 'link' | 'text';
  size?: 'small' | 'middle' | 'large';
  block?: boolean;
  disabled?: boolean;
}

export function DownloadButton({
  resourceType,
  artifactId,
  filename,
  label = '下载',
  buttonType = 'primary',
  size = 'middle',
  block,
  disabled,
}: Props) {
  const handleClick = (event: MouseEvent): void => {
    event.stopPropagation();
    trackClick('download', {
      resourceType,
      resourceId: artifactId,
      metadata: { filename },
    });
    // 下载路由用连字符段（public-file），埋点枚举用下划线（public_file）
    const urlType = resourceType === 'public_file' ? 'public-file' : resourceType;
    window.location.href = `/api/download/${urlType}/${artifactId}`;
  };

  return (
    <Button
      type={buttonType}
      size={size}
      icon={<DownloadOutlined />}
      block={block}
      disabled={disabled}
      onClick={handleClick}
    >
      {label}
    </Button>
  );
}
