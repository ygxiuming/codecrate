import { VersionCachePanel } from '../../components/VersionCachePanel';

export function VscodeCachePage() {
  return (
    <>
      <div className="page-title">
        <h2>VS Code 安装包缓存</h2>
        <p>
          选择官方版本与目标平台，系统会为每个「版本 × 平台」创建独立下载任务。默认覆盖 10
          个主流平台，可用「探测平台」先确认可用性。
        </p>
      </div>
      <VersionCachePanel mode="vscode" />
    </>
  );
}

export function RemoteCachePage() {
  return (
    <>
      <div className="page-title">
        <h2>Remote-SSH Server 缓存</h2>
        <p>
          按 VS Code 版本自动解析 commit，并缓存对应平台的 vscode-server。平台应选择远端主机架构，
          默认 Linux x64/ARM64/ARMHF。
        </p>
      </div>
      <VersionCachePanel mode="remote" />
    </>
  );
}
