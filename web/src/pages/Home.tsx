import { useEffect, useState } from 'react';
import { Button, Input, Skeleton, Tag, message } from 'antd';
import {
  AppstoreOutlined,
  ArrowRightOutlined,
  BookOutlined,
  CloudServerOutlined,
  CodeOutlined,
  DownloadOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
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
            内网开发环境，
            <br />
            <span>从这里一键离线部署。</span>
          </h1>
          <p className="hero-sub">
            集中缓存 VS Code 安装包、离线插件与 Remote-SSH Server。管理员联网采集一次，
            内网用户即可随时浏览、校验并下载，无需为每台机器重复准备安装介质。
          </p>
          <div className="hero-search">
            <Input
              size="large"
              allowClear
              prefix={<SearchOutlined style={{ color: '#7c93a9' }} />}
              placeholder="搜索已缓存的插件，例如 Python、Docker、Chinese"
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
              <span>已缓存 VS Code 版本</span>
            </div>
            <div className="hero-stat">
              <strong>{loading ? '—' : formatNumber(stats?.extensionCount)}</strong>
              <span>离线插件</span>
            </div>
            <div className="hero-stat">
              <strong>{loading ? '—' : formatNumber(stats?.remoteVersions)}</strong>
              <span>Remote-SSH 版本</span>
            </div>
            <div className="hero-stat">
              <strong>{loading ? '—' : formatBytes(stats?.totalBytes)}</strong>
              <span>离线资源总量</span>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-heading">
            <div>
              <h2>按需取用</h2>
              <p>三类资源独立版本管理，下载即用，支持断点续传与 SHA256 校验。</p>
            </div>
            <Link to="/docs" className="nav-link">
              <BookOutlined /> 查看使用说明
            </Link>
          </div>
          <div className="feature-grid">
            <Link to="/vscode" className="feature-card">
              <span className="feature-icon">
                <CodeOutlined />
              </span>
              <h3>VS Code 安装包</h3>
              <p>
                Windows、macOS、Linux 全平台缓存，包含用户/系统安装包、zip、tar.gz、deb
                与 rpm 格式，附 SHA256 校验文件。
              </p>
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
              <p>
                支持管理员上传 .vsix 或从市场一键缓存，自动解析 Publisher、版本、引擎范围与依赖，
                内网用户可直接下载安装。
              </p>
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
              <p>
                按 VS Code 版本解析 commit，缓存对应的 vscode-server 包，解决隔离环境远程开发
                无法下载 server 的问题。
              </p>
              <div className="feature-count">
                <strong>{formatNumber(stats?.remoteVersions)}</strong>
                <span>个版本</span>
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
                下载 → 拷贝 → 离线安装
              </h2>
              <p style={{ color: '#6b7f94', lineHeight: 1.85, margin: '0 0 16px', fontSize: 13.5 }}>
                在联网机器上由管理员缓存资源，把文件带到内网。插件通过命令行或 VS Code
                图形界面安装；Remote-SSH 需要预置 server 并匹配客户端 commit。
              </p>
              <ol style={{ color: '#425466', lineHeight: 2, paddingLeft: 20, fontSize: 13.5, margin: 0 }}>
                <li>在「VS Code 安装包」页面选择平台并下载安装。</li>
                <li>在「离线插件」页面下载 .vsix，使用下方命令安装。</li>
                <li>按「使用说明」配置 Remote-SSH，指向内网 server。</li>
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
          <div className="panel" style={{ background: 'linear-gradient(120deg, #0d2c49, #123f66)', border: 'none', color: '#eaf4ff' }}>
            <div className="row-between">
              <div>
                <h2 style={{ color: '#fff', margin: 0, fontSize: 21 }}>还差一步？查看完整离线配置指南</h2>
                <p style={{ color: 'rgba(224,238,252,0.72)', margin: '8px 0 0', fontSize: 13.5 }}>
                  包含 VS Code 安装、插件离线安装、Remote-SSH server 预置与常见问题排查。
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
