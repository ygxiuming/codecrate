import { Tag } from 'antd';
import type { TaskKind, TaskStatus } from '../api/types';

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  queued: '排队中',
  running: '下载中',
  success: '成功',
  failed: '失败',
  canceled: '已取消',
};

const TASK_STATUS_COLOR: Record<TaskStatus, string> = {
  queued: 'default',
  running: 'processing',
  success: 'green',
  failed: 'red',
  canceled: 'orange',
};

export const TASK_KIND_LABEL: Record<TaskKind, string> = {
  vscode_package: 'VS Code 安装包',
  remote_server: 'Remote-SSH Server',
  extension: '插件',
};

export function TaskStatusTag({ status }: { status: TaskStatus }) {
  return (
    <Tag color={TASK_STATUS_COLOR[status]} style={{ borderRadius: 999 }}>
      {TASK_STATUS_LABEL[status]}
    </Tag>
  );
}

export function TaskKindTag({ kind }: { kind: TaskKind }) {
  const color = kind === 'vscode_package' ? 'blue' : kind === 'remote_server' ? 'geekblue' : 'purple';
  return (
    <Tag color={color} style={{ borderRadius: 999 }}>
      {TASK_KIND_LABEL[kind] ?? kind}
    </Tag>
  );
}

export function taskPercent(progress: number, total: number, status: TaskStatus): number {
  if (status === 'success') return 100;
  if (!total) return status === 'running' ? 8 : 0;
  return Math.max(0, Math.min(100, Math.round((progress / total) * 100)));
}
