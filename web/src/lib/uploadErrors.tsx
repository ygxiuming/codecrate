import { Modal, Tag } from 'antd';
import { ApiRequestError } from '../api/client';

export interface UploadDuplicate {
  source: 'public' | 'software';
  name: string;
  info: string;
}

interface DuplicateDetails {
  duplicates?: UploadDuplicate[];
}

/** 上传查重命中（409 DUPLICATE_FILE）时，弹窗展示与哪些资源重复。 */
export function showUploadDuplicateModal(error: unknown): void {
  const requestError = error as ApiRequestError;
  if (requestError?.code === 'DUPLICATE_FILE') {
    const duplicates =
      (requestError.details as DuplicateDetails | undefined)?.duplicates ?? [];
    Modal.warning({
      title: '内容重复，本次上传未保存',
      width: 520,
      content: (
        <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
          <div style={{ fontSize: 12.5, color: '#6b7f94' }}>
            以下已有资源的 SHA256 与本次上传的文件完全相同：
          </div>
          {duplicates.map((item, index) => (
            <div key={index} style={{ fontSize: 13, lineHeight: 1.6 }}>
              <Tag
                color={item.source === 'software' ? 'blue' : 'green'}
                style={{ borderRadius: 999, marginRight: 8 }}
              >
                {item.source === 'software' ? '软件包' : '公共区'}
              </Tag>
              <strong>{item.name}</strong>
              <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                {item.info}
              </div>
            </div>
          ))}
          <div style={{ fontSize: 12.5, color: '#6b7f94' }}>
            如需重新分发，请先删除对应资源，或直接引导用户下载已有文件。
          </div>
        </div>
      ),
    });
    return;
  }
  Modal.error({ title: '上传失败', content: (error as Error).message });
}
