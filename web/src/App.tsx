import { Route, Routes } from 'react-router-dom';
import { Result } from 'antd';
import { AdminLayout } from './components/AdminLayout';
import { PublicLayout } from './components/PublicLayout';
import { DocsPage } from './pages/Docs';
import { ExtensionsPage } from './pages/Extensions';
import { HomePage } from './pages/Home';
import { RemoteSshPage } from './pages/RemoteSsh';
import { VscodePage } from './pages/Vscode';
import { AdminLoginPage } from './pages/admin/Login';
import { AnnouncementsPage } from './pages/admin/Announcements';
import { DashboardPage } from './pages/admin/Dashboard';
import { ExtensionsAdminPage } from './pages/admin/ExtensionsAdmin';
import { MarketplacePage } from './pages/admin/Marketplace';
import { RemoteCachePage, VscodeCachePage } from './pages/admin/VersionCache';
import { TasksPage } from './pages/admin/Tasks';
import { StoragePage } from './pages/admin/Storage';
import { AnalyticsPage } from './pages/admin/Analytics';
import { LogsPage } from './pages/admin/Logs';
import { SettingsPage } from './pages/admin/Settings';

export default function App() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route index element={<HomePage />} />
        <Route path="vscode" element={<VscodePage />} />
        <Route path="extensions" element={<ExtensionsPage />} />
        <Route path="remote-ssh" element={<RemoteSshPage />} />
        <Route path="docs" element={<DocsPage />} />
      </Route>

      <Route path="/admin/login" element={<AdminLoginPage />} />
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="announcements" element={<AnnouncementsPage />} />
        <Route path="vscode" element={<VscodeCachePage />} />
        <Route path="extensions" element={<ExtensionsAdminPage />} />
        <Route path="marketplace" element={<MarketplacePage />} />
        <Route path="remote" element={<RemoteCachePage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="storage" element={<StoragePage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="logs" element={<LogsPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>

      <Route
        path="*"
        element={
          <Result
            status="404"
            title="页面不存在"
            subTitle="请检查地址，或返回首页继续浏览离线资源。"
            extra={<a href="/">返回首页</a>}
          />
        }
      />
    </Routes>
  );
}
