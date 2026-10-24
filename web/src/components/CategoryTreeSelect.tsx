import { useMemo, useState } from 'react';
import { Button, Input, TreeSelect } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import type { DefaultOptionType } from 'antd/es/select';
import {
  buildCategoryTree,
  type CategoryNode,
} from '../lib/softwareMeta';

const MAX_DEPTH = 3;
const MAX_SEGMENT = 30;

interface TreeNode extends DefaultOptionType {
  value: string;
  title: string;
  children?: TreeNode[];
}

function toTreeData(nodes: CategoryNode[], showCount: boolean): TreeNode[] {
  return nodes.map((node) => ({
    value: node.path,
    title: showCount ? `${node.name}（${node.total}）` : node.name,
    children: node.children.length ? toTreeData(node.children, showCount) : undefined,
  }));
}

/** 规范化输入的新分类路径：去空白、去空段，校验层级与段长。 */
function normalizeNewPath(raw: string): string {
  const parts = raw
    .split('/')
    .map((part) => part.trim().slice(0, MAX_SEGMENT))
    .filter(Boolean)
    .slice(0, MAX_DEPTH);
  return parts.join('/');
}

/**
 * 多级分类选择器：
 * - 以「/」路径为值（如「开发工具/IDE」），树形展示现有分类；
 * - 弹出层底部可内联输入新路径，允许创建尚未存在的分类。
 */
export function CategoryTreeSelect({
  value,
  onChange,
  categories,
  allowClear = true,
  allowCreate = true,
  showCount = false,
  placeholder = '选择分类，可在底部新建',
  style,
  size,
}: {
  value?: string;
  onChange?: (value: string) => void;
  categories: Array<{ category: string; count: number }>;
  allowClear?: boolean;
  allowCreate?: boolean;
  showCount?: boolean;
  placeholder?: string;
  style?: React.CSSProperties;
  size?: 'small' | 'middle' | 'large';
}) {
  const [newPath, setNewPath] = useState('');
  const treeData = useMemo(
    () => toTreeData(buildCategoryTree(categories), showCount),
    [categories, showCount],
  );

  const applyNewPath = (): void => {
    const normalized = normalizeNewPath(newPath);
    if (!normalized) return;
    onChange?.(normalized);
    setNewPath('');
  };

  return (
    <TreeSelect
      value={value || undefined}
      onChange={(next) => onChange?.(typeof next === 'string' ? next : '')}
      treeData={treeData}
      treeDefaultExpandAll
      showSearch
      treeNodeFilterProp="title"
      allowClear={allowClear}
      placeholder={placeholder}
      style={{ width: '100%', ...style }}
      size={size}
      popupRender={(menu) => (
        <div onClick={(event) => event.stopPropagation()}>
          {menu}
          {allowCreate ? (
            <div className="cat-create-row">
              <Input
                size="small"
                placeholder="新分类路径，如：开发工具/IDE"
                value={newPath}
                onChange={(event) => setNewPath(event.target.value)}
                onPressEnter={applyNewPath}
                maxLength={90}
              />
              <Button size="small" type="primary" icon={<PlusOutlined />} onClick={applyNewPath}>
                新建
              </Button>
            </div>
          ) : null}
        </div>
      )}
    />
  );
}
