import {ProLayoutProps} from '@ant-design/pro-components'

/**
 * @name
 */
const Settings: ProLayoutProps & {
  pwa?: boolean;
  logo?: string;
} = {
  navTheme: 'light',
  colorPrimary: '#916E40',
  layout: 'mix',
  contentWidth: 'Fluid',
  fixedHeader: false,
  fixSiderbar: true,
  pwa: true,
  logo: '/logo_white.svg',
  splitMenus: false,
  title: '应用平台',
  iconfontUrl: '',
  siderMenuType: 'sub',
  token: {
    // 参见ts声明，demo 见文档，通过token 修改样式
    //https://procomponents.ant.design/components/layout#%E9%80%9A%E8%BF%87-token-%E4%BF%AE%E6%94%B9%E6%A0%B7%E5%BC%8F
    sider: {
      colorMenuBackground: '#fff',
      colorBgMenuItemSelected: '#E9E1D0',
      colorTextMenuSelected: '#fff'
    },
    header: {
      heightLayoutHeader: 64,
      colorBgHeader: '#916E40',
      colorHeaderTitle: '#fff',
      colorTextRightActionsItem: '#fff',
      colorBgRightActionsItemHover: '#6B4D2A',
    },
    colorTextAppListIcon: '#fff',
    colorTextAppListIconHover: '#fff',
    colorBgAppListIconHover: '#6B4D2A',
  },
}

export default Settings
