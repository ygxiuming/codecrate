import { useEffect, useState } from 'react';
import { Button, Input, Skeleton, Tag, message } from 'antd';
import {
  AppstoreOutlined,
  ArrowRightOutlined,
  BookOutlined,
  CloudServerOutlined,
  CloudUploadOutlined,
  CodeOutlined,
  CommentOutlined,
  DownloadOutlined,
  GithubOutlined,
  InboxOutlined,
  QrcodeOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  StarFilled,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { api, qs } from '../api/client';
import type {
  ExtensionItem,
  ExtensionListResponse,
  RemoteVersion,
  Stats,
  VscodeListResponse,
  VscodeVersion,
} from '../api/types';
import { CodeBlock } from '../components/CodeBlock';
import { ExtensionCard } from '../components/ExtensionCard';
import { formatBytes, formatNumber } from '../lib/format';
import { PROJECT } from '../lib/project';
import { trackSearch } from '../lib/tracker';

export function HomePage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<Stats | null>(null);
  const [latest, setLatest] = useState<ExtensionItem[]>([]);
  const [versions, setVersions] = useState<VscodeVersion[]>([]);
  const [remote, setRemote] = useState<RemoteVersion[]>([]);
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.get<Stats>('/api/public/stats'),
      api.get<ExtensionListResponse>('/api/public/extensions?pageSize=6&sort=updated'),
      api.get<VscodeListResponse>('/api/public/vscode?pageSize=4'),
      api.get<{ items: RemoteVersion[] }>('/api/public/remote-servers?pageSize=3'),
    ])
      .then(([statsData, extensionData, vscodeData, remoteData]) => {
        if (!active) return;
        setStats(statsData);
        setLatest(extensionData.items);
        setVersions(vscodeData.items);
        setRemote(remoteData.items);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const search = (): void => {
    const value = keyword.trim();
    if (!value) {
      navigate('/extensions');
      return;
    }
    trackSearch(value);
    message.success(`正在搜索：${value}`);
    navigate(`/extensions${qs({ q: value })}`);
  };

  return (
    <>
      <section className="hero">
        <div className="container hero-inner">
          <span className="hero-badge">
            <SafetyCertificateOutlined />
            完全隔离内网 · 不依赖外网 CDN
          </span>
          <h1 className="hero-title">
            内网资源分发，
            <br />
            <span>从这里一键搞定。</span>
          </h1>
          <p className="hero-sub">
            软件安装包、VS Code 资源、公共文件区与取件码传递。管理员统一发布一次，
            内网用户即可随时浏览、校验并下载，无需为每台机器重复准备安装介质。
          </p>
          <div className="hero-repo">
            <GithubOutlined />
            <span>开源项目 · MIT License · 源码与更新见 GitHub</span>
            <a href={PROJECT.repoUrl} target="_blank" rel="noopener noreferrer">
              前往仓库 <ArrowRightOutlined />
            </a>
          </div>
          <div className="hero-search">
            <Input
              size="large"
              allowClear
              prefix={<SearchOutlined style={{ color: '#7c93a9' }} />}
              placeholder="搜索离线插件，例如 Python、Docker、Chinese"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              onPressEnter={search}
              suffix={
                <Button type="primary" onClick={search}>
                  搜索
                </Button>
              }
            />
          </div>
          <div className="hero-stats">
            <div className="hero-stat">
              <strong>{loading ? '—' : formatNumber(stats?.vscodeVersions)}</strong>
              <span>VS Code 版本</span>
            </div>
            <div className="hero-stat">
              <strong>{loading ? '—' : formatNumber(stats?.extensionCount)}</strong>
              <span>离线插件</span>
            </div>
            <div className="hero-stat">
              <strong>{loading ? '—' : formatNumber(stats?.softwareCount)}</strong>
              <span>软件安装包</span>
            </div>
            <div className="hero-stat">
              <strong>{loading ? '—' : formatBytes(stats?.totalBytes)}</strong>
              <span>资源总量</span>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-heading">
            <div>
              <h2>资源模块</h2>
              <p>安装包、插件、server 与日常文件统一入口，全部支持 SHA256 校验与断点续传。</p>
            </div>
            <Link to="/docs" className="nav-link">
              <BookOutlined /> 查看使用说明
            </Link>
          </div>
          <div className="feature-grid feature-grid-auto">
            <Link to="/software" className="feature-card">
              <span className="feature-icon">
                <InboxOutlined />
              </span>
              <h3>软件安装包</h3>
              <p>常用软件按分类归档，附 Markdown 说明与校验值；管理员上传或目录自动扫描。</p>
              <div className="feature-count">
                <strong>{formatNumber(stats?.softwareCount)}</strong>
                <span>个安装包</span>
              </div>
            </Link>
            <Link to="/vscode" className="feature-card">
              <span className="feature-icon">
                <CodeOutlined />
              </span>
              <h3>VS Code 安装包</h3>
              <p>Windows、macOS、Linux 全平台缓存，包含用户/系统安装包与 zip、tar.gz、deb、rpm 格式。</p>
              <div className="feature-count">
                <strong>{formatNumber(stats?.vscodeVersions)}</strong>
                <span>个版本</span>
              </div>
            </Link>
            <Link to="/extensions" className="feature-card">
              <span className="feature-icon">
                <AppstoreOutlined />
              </span>
              <h3>离线插件市场</h3>
              <p>上传 .vsix 或从官方市场一键缓存，自动解析 Publisher、引擎范围与依赖。</p>
              <div className="feature-count">
                <strong>{formatNumber(stats?.extensionCount)}</strong>
                <span>个插件</span>
              </div>
            </Link>
            <Link to="/remote-ssh" className="feature-card">
              <span className="feature-icon">
                <CloudServerOutlined />
              </span>
              <h3>Remote-SSH Server</h3>
              <p>按版本解析 commit 并缓存 vscode-server，解决隔离环境无法下载 server 的问题。</p>
              <div className="feature-count">
                <strong>{formatNumber(stats?.remoteVersions)}</strong>
                <span>个版本</span>
              </div>
            </Link>
            <Link to="/zone" className="feature-card">
              <span className="feature-icon">
                <CloudUploadOutlined />
              </span>
              <h3>公共文件区</h3>
              <p>上传文件所有人可见，展示剩余有效期，到期由系统自动删除，限额可由管理员配置。</p>
              <div className="feature-count">
                <strong>{formatNumber(stats?.publicFileCount)}</strong>
                <span>个文件</span>
              </div>
            </Link>
            <Link to="/pickup" className="feature-card">
              <span className="feature-icon">
                <QrcodeOutlined />
              </span>
              <h3>取件传递</h3>
              <p>私人文件凭取件码领取，对外不可见；可设有效期与下载次数，管理员可随时撤销。</p>
              <div className="feature-count">
                <strong>取件码</strong>
                <span>免登录领取</span>
              </div>
            </Link>
            <Link to="/board" className="feature-card">
              <span className="feature-icon">
                <CommentOutlined />
              </span>
              <h3>留言板</h3>
              <p>内网公共留言与软件包反馈，支持两层回复与置顶；评论自动展示内网 IPv4。</p>
              <div className="feature-count">
                <strong>两层回复</strong>
                <span>管理员置顶</span>
              </div>
            </Link>
            <Link to="/docs" className="feature-card">
              <span className="feature-icon">
                <BookOutlined />
              </span>
              <h3>使用说明</h3>
              <p>软件包发布、插件离线安装、Remote-SSH 预置与文件区/取件的完整图文手册。</p>
              <div className="feature-count">
                <strong>7 篇</strong>
                <span>图文指南</span>
              </div>
            </Link>
          </div>
        </div>
      </section>

      <section className="section-tight">
        <div className="container">
          <div className="panel quickstart-grid">
            <div>
              <Tag color="blue" style={{ borderRadius: 999 }}>
                <ThunderboltOutlined /> 30 秒上手
              </Tag>
              <h2 style={{ margin: '14px 0 8px', fontSize: 22, letterSpacing: '-0.015em' }}>
                发布 → 浏览 → 下载安装
              </h2>
              <p style={{ color: '#6b7f94', lineHeight: 1.85, margin: '0 0 16px', fontSize: 13.5 }}>
                管理员在联网环境缓存或上传资源，内网用户直接浏览下载。临时文件走公共区或取件传递，
                到期自动清理，不留垃圾。
              </p>
              <ol style={{ color: '#425466', lineHeight: 2, paddingLeft: 20, fontSize: 13.5, margin: 0 }}>
                <li>在「软件包」或「VS Code」页面选择平台并下载安装。</li>
                <li>在「离线插件」下载 .vsix，使用右侧命令离线安装。</li>
                <li>临时文件上传「公共区」，私人文件用「取件传递」发取件码。</li>
              </ol>
            </div>
            <div>
              <CodeBlock code={'# 使用命令行离线安装插件\ncode --install-extension my-extension-1.0.0.vsix\n\n# 查看已安装插件\ncode --list-extensions --show-versions'} />
              <div style={{ marginTop: 14, fontSize: 12.5, color: '#6b7f94', lineHeight: 1.8 }}>
                Windows 若无 <code>code</code> 命令，可使用 VS Code 中「扩展 → 从 VSIX 安装…」。
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section-tight">
        <div className="container">
          <div className="section-heading">
            <div>
              <h2>最近更新的插件</h2>
              <p>由管理员从官方市场或上传的 vsix 缓存而来。</p>
            </div>
            <Link to="/extensions" className="nav-link">
              查看全部 <ArrowRightOutlined />
            </Link>
          </div>
          {loading ? (
            <div className="ext-grid">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="panel">
                  <Skeleton active paragraph={{ rows: 3 }} />
                </div>
              ))}
            </div>
          ) : latest.length > 0 ? (
            <div className="ext-grid">
              {latest.slice(0, 6).map((item) => (
                <ExtensionCard key={`${item.id}`} item={item} onClick={() => navigate('/extensions')} />
              ))}
            </div>
          ) : (
            <div className="panel empty-wrap" style={{ boxShadow: 'none' }}>
              <div style={{ fontSize: 34, marginBottom: 10, color: '#b6c7d8' }}>
                <AppstoreOutlined />
              </div>
              <div>还没有缓存插件。管理员可在后台通过 .vsix 上传或市场缓存添加。</div>
            </div>
          )}

          {versions.length > 0 || remote.length > 0 ? (
            <div className="panel" style={{ marginTop: 18 }}>
              <div className="row-between" style={{ marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>最近缓存的版本</strong>
                <div className="chip-row">
                  {versions.map((item) => (
                    <Link key={item.version} to="/vscode">
                      <Tag color="blue" style={{ borderRadius: 999 }}>
                        <CodeOutlined /> {item.version}
                      </Tag>
                    </Link>
                  ))}
                  {remote.map((item) => (
                    <Link key={`r-${item.version}`} to="/remote-ssh">
                      <Tag style={{ borderRadius: 999 }}>
                        <CloudServerOutlined /> {item.version}
                      </Tag>
                    </Link>
                  ))}
                </div>
              </div>
              <div style={{ fontSize: 12.5, color: '#8497a9' }}>
                共 {formatNumber(stats?.downloads)} 次下载 · 当前占用{' '}
                {formatBytes(stats?.totalBytes)} · 磁盘剩余 {formatBytes(stats?.disk.freeBytes)}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="section-tight">
        <div className="container">
          <div className="panel star-card">
            <div className="star-card-icon">
              <GithubOutlined />
            </div>
            <div className="star-card-body">
              <Tag color="blue" style={{ borderRadius: 999 }}>
                开源 · {PROJECT.license}
              </Tag>
              <h2>喜欢 CodeCrate？在 GitHub 给我们一颗 Star</h2>
              <p>
                {PROJECT.description}
                如果它帮你解决了隔离内网的资源分发问题，欢迎点个 Star、提交 Issue
                或参与贡献，这是对项目最直接的支持。
              </p>
              <div className="star-card-actions">
                <Button
                  type="primary"
                  size="large"
                  icon={<StarFilled />}
                  href={PROJECT.repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  去 GitHub 点 Star
                </Button>
                <Button
                  size="large"
                  icon={<GithubOutlined />}
                  href={PROJECT.repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  查看源码
                </Button>
                <a
                  className="star-card-link"
                  href={PROJECT.issuesUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  反馈问题
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section-tight">
        <div className="container">
          <div className="panel" style={{ background: 'linear-gradient(120deg, #0d2c49, #123f66)', border: 'none', color: '#eaf4ff' }}>
            <div className="row-between">
              <div>
                <h2 style={{ color: '#fff', margin: 0, fontSize: 21 }}>还差一步？查看完整使用指南</h2>
                <p style={{ color: 'rgba(224,238,252,0.72)', margin: '8px 0 0', fontSize: 13.5 }}>
                  包含软件包发布、VS Code 安装、插件离线安装、Remote-SSH 预置与文件区使用说明。
                </p>
              </div>
              <Link to="/docs">
                <Button type="primary" size="large" icon={<DownloadOutlined />} style={{ background: '#fff', color: '#0b2a45', borderColor: '#fff' }}>
                  打开使用说明
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
