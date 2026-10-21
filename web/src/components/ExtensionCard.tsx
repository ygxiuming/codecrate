import { useState } from 'react';
import { Tag } from 'antd';
import { formatDay, formatNumber } from '../lib/format';
import type { ExtensionItem } from '../api/types';

export function ExtensionCard({
  item,
  onClick,
}: {
  item: ExtensionItem;
  onClick: () => void;
}) {
  const [iconFailed, setIconFailed] = useState(false);
  return (
    <article
      className="ext-card"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onClick();
      }}
    >
      <div className="ext-head">
        <div className="ext-icon">
          {item.iconUrl && !iconFailed ? (
            <img src={item.iconUrl} alt="" loading="lazy" onError={() => setIconFailed(true)} />
          ) : (
            (item.displayName || item.name).slice(0, 1).toUpperCase()
          )}
        </div>
        <div className="ext-name">
          <h3 title={item.displayName}>{item.displayName}</h3>
          <div className="ext-publisher">
            {item.publisher} · v{item.version}
          </div>
        </div>
      </div>
      <p className="ext-desc">{item.description || '暂无插件描述'}</p>
      <div className="chip-row">
        {item.categories.slice(0, 2).map((category) => (
          <span key={category} className="tag-soft">
            {category}
          </span>
        ))}
        {item.engineRange ? (
          <span className="tag-soft" title="支持的 VS Code 版本范围">
            VS Code {item.engineRange}
          </span>
        ) : null}
        {item.targetPlatform && item.targetPlatform !== 'universal' ? (
          <span className="tag-soft">{item.targetPlatform}</span>
        ) : null}
      </div>
      <div className="ext-foot">
        <span>{formatNumber(item.downloadCount)} 次下载</span>
        <span>
          {item.versionsCount > 1 ? `${item.versionsCount} 个版本 · ` : ''}
          {formatDay(item.updatedAt)}
        </span>
      </div>
    </article>
  );
}

export function CategoryTags({ categories }: { categories: string[] }) {
  return (
    <>
      {categories.slice(0, 3).map((category) => (
        <Tag key={category} style={{ borderRadius: 999 }}>
          {category}
        </Tag>
      ))}
    </>
  );
}
