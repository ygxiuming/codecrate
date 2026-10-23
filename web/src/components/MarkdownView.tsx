import { isValidElement, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './CodeBlock';

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

/** 渲染后端存储的 markdown 字符串（软件包说明等），样式复用 .markdown-body。 */
export function MarkdownView({ content }: { content: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
