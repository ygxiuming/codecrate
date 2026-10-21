import { isValidElement, useEffect, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Tag, Tabs } from 'antd';
import {
  ApiOutlined,
  BookOutlined,
  CloudServerOutlined,
  QuestionCircleOutlined,
  SettingOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import type { PublicConfig } from '../api/types';
import { CodeBlock } from '../components/CodeBlock';
import { trackClick } from '../lib/tracker';

const DOCS = import.meta.glob('../content/docs/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const TABS = [
  { key: 'user-guide', label: '安装 VS Code', file: 'user-guide', icon: <BookOutlined /> },
  { key: 'extension-install', label: '离线安装插件', file: 'extension-install', icon: <ToolOutlined /> },
  { key: 'vscode-gallery', label: 'VS Code 接入', file: 'vscode-gallery', icon: <ApiOutlined /> },
  { key: 'remote-ssh', label: 'Remote-SSH', file: 'remote-ssh', icon: <CloudServerOutlined /> },
  { key: 'admin-guide', label: '管理员手册', file: 'admin-guide', icon: <SettingOutlined /> },
  { key: 'faq', label: '常见问题', file: 'faq', icon: <QuestionCircleOutlined /> },
];

function extractText(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (isValidElement(node)) {
    return extractText((node.props as { children?: ReactNode }).children);
  }
  return '';
}

const MARKDOWN_COMPONENTS: Components = {
  pre({ children }) {
    return <CodeBlock code={extractText(children).replace(/\n$/, '')} />;
  },
  a({ href, children }) {
    const external = Boolean(href && /^https?:\/\//i.test(href));
    return (
      <a
        href={href}
        target={external ? '_blank' : undefined}
        rel={external ? 'noreferrer noopener' : undefined}
      >
        {children}
      </a>
    );
  },
  img({ src, alt }) {
    return <img src={src} alt={alt ?? ''} loading="lazy" />;
  },
  table({ children }) {
    return (
      <div style={{ overflowX: 'auto' }}>
        <table>{children}</table>
      </div>
    );
  },
};

export function DocsPage() {
  const [params, setParams] = useSearchParams();
  const [baseUrl, setBaseUrl] = useState(() => window.location.origin);

  useEffect(() => {
    void api
      .get<PublicConfig>('/api/public/config')
      .then((config) => {
        if (config.galleryBaseUrl) setBaseUrl(config.galleryBaseUrl.replace(/\/+$/, ''));
      })
      .catch(() => undefined);
  }, []);
  const requested = params.get('tab') ?? 'user-guide';
  const active = TABS.some((tab) => tab.key === requested) ? requested : 'user-guide';

  return (
    <>
      <div className="docs-hero">
        <div className="container">
          <div className="row-between">
            <div>
              <h1>
                <BookOutlined style={{ color: '#0078d4', marginRight: 10 }} />
                使用说明
              </h1>
              <p>面向普通用户的安装与使用指南，以及管理员的后台操作手册。</p>
            </div>
            <div className="chip-row">
              <Tag color="blue" style={{ borderRadius: 999 }}>
                内网离线
              </Tag>
              <Tag color="green" style={{ borderRadius: 999 }}>
                含 Remote-SSH 配置
              </Tag>
            </div>
          </div>
        </div>
      </div>

      <div className="container">
        <div className="docs-panel">
          <Tabs
            className="docs-nav"
            activeKey={active}
            onChange={(key) => {
              setParams(key === 'user-guide' ? {} : { tab: key }, { replace: true });
              trackClick('doc_tab', { metadata: { tab: key } });
            }}
            items={TABS.map((tab) => {
              const raw =
                DOCS[`../content/docs/${tab.file}.md`] ?? '文档内容缺失，请检查安装包完整性。';
              const content = raw.split('__BASE_URL__').join(baseUrl);
              return {
                key: tab.key,
                label: (
                  <span>
                    {tab.icon}
                    <span style={{ marginLeft: 6 }}>{tab.label}</span>
                  </span>
                ),
                children: (
                  <div className="markdown-body">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                      {content}
                    </ReactMarkdown>
                  </div>
                ),
              };
            })}
          />
        </div>
      </div>
    </>
  );
}
