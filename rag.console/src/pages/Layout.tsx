import {Outlet, useModel} from '@umijs/max';
import {ConfigProvider, theme} from 'antd';
import {useRouteProps} from '@umijs/max'
import {toLogin} from "@/utils/authority";

export default function Layout() {
  const routeProps = useRouteProps();
  const {initialState} = useModel('@@initialState');
  const {currentUser} = initialState || {};
  if (routeProps.authority && !currentUser) {
    return toLogin()
  }
  return <div className='app-main'><Outlet/></div>
}
