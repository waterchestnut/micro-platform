/**
 * @description 精简版路由配置，相关页面只有内容区域，没有菜单和头部
 */
export default [
  {
    path: '/lite',
    access: 'normalRouteFilter',
    authority: ['all'],
    hideInMenu: true,
    layout: false,
    component: './Layout',
    routes: [
      {
        path: '/lite/personal/profile',
        name: 'profile',
        component: './Personal/Profile',
      },
      {
        path: '/lite/personal/setting',
        name: 'setting',
        component: './Personal/Setting',
      },
    ],
  }
]
