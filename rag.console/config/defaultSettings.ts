import {ProLayoutProps} from '@ant-design/pro-components';

/**
 * @name
 */
const Settings: ProLayoutProps & {
  pwa?: boolean;
  logo?: string;
} = {
  navTheme: 'light',
  colorPrimary: '#08979c',
  layout: 'mix',
  contentWidth: 'Fluid',
  fixedHeader: false,
  fixSiderbar: true,
  pwa: true,
  logo: "/logo_white.svg",
  splitMenus: false,
  title: '知识库',
  iconfontUrl: '',
  siderMenuType: "sub",
  token: {
    // 参见ts声明，demo 见文档，通过token 修改样式
    //https://procomponents.ant.design/components/layout#%E9%80%9A%E8%BF%87-token-%E4%BF%AE%E6%94%B9%E6%A0%B7%E5%BC%8F
    sider: {
      colorMenuBackground: '#fff',
      colorBgMenuItemSelected: '#67c2bc',
      colorTextMenuSelected: '#fff'
    },
    header: {
      heightLayoutHeader: 64,
      colorBgHeader: '#08979c',
      colorHeaderTitle: '#fff',
      colorTextRightActionsItem: '#fff',
      colorBgRightActionsItemHover: '#9c084d',
    },
    colorTextAppListIcon: '#fff',
    colorTextAppListIconHover: '#fff',
    colorBgAppListIconHover: '#9c084d',
  },
};

export default Settings;
