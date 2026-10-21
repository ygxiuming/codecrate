import type { ThemeConfig } from 'antd';

export const themeConfig: ThemeConfig = {
  token: {
    colorPrimary: '#0078d4',
    colorInfo: '#0078d4',
    colorLink: '#0066b8',
    colorSuccess: '#1f9d55',
    colorWarning: '#d97706',
    colorError: '#d92d20',
    colorBgLayout: '#f5f7fa',
    colorBorderSecondary: '#e8edf4',
    borderRadius: 10,
    borderRadiusLG: 14,
    controlHeight: 38,
    fontSize: 14,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
    boxShadowSecondary: '0 12px 32px rgba(15, 35, 58, 0.08)',
  },
  components: {
    Layout: {
      headerBg: 'transparent',
      bodyBg: '#f5f7fa',
      siderBg: '#0b1f33',
    },
    Menu: {
      darkItemBg: 'transparent',
      darkItemSelectedBg: 'rgba(0, 120, 212, 0.22)',
      darkItemHoverBg: 'rgba(255, 255, 255, 0.06)',
      darkItemSelectedColor: '#ffffff',
      darkItemColor: 'rgba(226, 238, 250, 0.72)',
    },
    Card: {
      paddingLG: 22,
    },
    Table: {
      headerBg: '#f7f9fc',
      headerColor: '#425466',
      rowHoverBg: '#f5f9ff',
    },
  },
};
