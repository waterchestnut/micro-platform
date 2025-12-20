/**
 * @name umi 的路由配置
 * @description 只支持 path,component,routes,redirect,wrappers,name,icon 的配置
 * @param path  path 只支持两种占位符配置，第一种是动态参数 :id 的形式，第二种是 * 通配符，通配符只能出现路由字符串的最后。
 * @param component 配置 location 和 path 匹配后用于渲染的 React 组件路径。可以是绝对路径，也可以是相对路径，如果是相对路径，会从 src/pages 开始找起。
 * @param routes 配置子路由，通常在需要为多个路径增加 layout 组件时使用。
 * @param redirect 配置路由跳转
 * @param wrappers 配置路由组件的包装组件，通过包装组件可以为当前的路由组件组合进更多的功能。 比如，可以用于路由级别的权限校验
 * @param name 配置路由的标题，默认读取国际化文件 menu.ts 中 menu.xxxx 的值，如配置 name 为 login，则读取 menu.ts 中 menu.login 的取值作为标题
 * @param icon 配置路由的图标，取值参考 https://ant.design/components/icon-cn， 注意去除风格后缀和大小写，如想要配置图标为 <StepBackwardOutlined /> 则取值应为 stepBackward 或 StepBackward，如想要配置图标为 <UserOutlined /> 则取值应为 user 或者 User
 * @doc https://umijs.org/docs/guides/routes
 */
export default [
  {
    name: 'login',
    path: '/user/login',
    component: './User/Login',
    layout: false,
  },
  {
    path: '/',
    access: 'normalRouteFilter',
    authority: false,
    component: './Layout',
    flatMenu: true,
    routes: [
      {
        path: '/home',
        name: 'home',
        icon: 'home',
        component: './Home',
      },
      {
        name: 'user.list',
        icon: 'user',
        path: '/user/list',
        access: 'normalRouteFilter',
        authority: ['all'],
        component: './User/List',
      },
      {
        name: 'group.list',
        icon: 'team',
        path: '/group/list',
        access: 'normalRouteFilter',
        authority: ['all'],
        component: './Group/List',
      },
      {
        name: 'client.list',
        icon: 'appstore',
        path: '/client/list',
        access: 'normalRouteFilter',
        authority: ['all'],
        component: './Client/List',
      },
      {
        path: '/auth',
        name: 'auth',
        icon: 'safety',
        access: 'normalRouteFilter',
        authority: ['all'],
        routes: [
          {
            path: '/auth',
            redirect: '/auth/priv',
          },
          {
            path: '/auth/module',
            name: 'module',
            access: 'normalRouteFilter',
            authority: ['all'],
            component: './Auth/Module',
          },
          {
            path: '/auth/priv',
            name: 'priv',
            access: 'normalRouteFilter',
            authority: ['all'],
            component: './Auth/Priv',
          },
          {
            path: '/auth/page',
            name: 'page',
            access: 'normalRouteFilter',
            authority: ['all'],
            component: './Auth/Page',
          },
        ],
      },
      {
        name: 'org.list',
        icon: 'group',
        path: '/org/list',
        access: 'normalRouteFilter',
        authority: ['all'],
        component: './Org/List',
      },
      {
        name: 'department.list',
        icon: 'partition',
        path: '/department/list',
        access: 'normalRouteFilter',
        authority: ['all'],
        component: './Department/List',
      },
      {
        name: 'job.list',
        icon: 'userSwitch',
        path: '/job/list',
        access: 'normalRouteFilter',
        authority: ['all'],
        component: './Job/List',
      },
      {
        name: 'region.list',
        icon: 'environment',
        path: '/region/list',
        access: 'normalRouteFilter',
        authority: ['all'],
        component: './Region/List',
      },
      {
        path: '/phonenumber',
        name: 'phonenumber',
        icon: 'home',
        component: './Phone/Query',
      },
      {
        path: '/',
        redirect: '/home',
      },
    ]
  },
  {
    path: '*',
    layout: false,
    component: './404',
  },
];
