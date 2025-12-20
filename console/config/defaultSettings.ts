import {ProLayoutProps} from '@ant-design/pro-components';

/**
 * @name
 */
const Settings: ProLayoutProps & {
  pwa?: boolean;
  logo?: string;
} = {
  navTheme: 'light',
  colorPrimary: '#F5222D',
  layout: 'top',
  contentWidth: 'Fluid',
  fixedHeader: true,
  fixSiderbar: true,
  pwa: true,
  logo: "/logo_white.svg",
  splitMenus: false,
  title: '微平台',
  iconfontUrl: '',
  token: {
    // 参见ts声明，demo 见文档，通过token 修改样式
    //https://procomponents.ant.design/components/layout#%E9%80%9A%E8%BF%87-token-%E4%BF%AE%E6%94%B9%E6%A0%B7%E5%BC%8F
    sider: {},
    header: {
      heightLayoutHeader: 64,
      colorBgHeader: 'rgba(245, 34, 45, 0.8)',
      colorHeaderTitle: '#fff',
      colorTextRightActionsItem: '#fff',
      colorBgRightActionsItemHover: 'rgba(255, 255, 255, 0.2)',
    },
    pageContainer: {
      paddingBlockPageContainerContent: 0,
      paddingInlinePageContainerContent: 0
    },
    colorTextAppListIcon:'#fff',
    colorTextAppListIconHover:'#fff',
    colorBgAppListIconHover:'rgba(255, 255, 255, 0.2)',
  },
  menuProps: {
    className: 'app-menu'
  }
};

export default Settings;
