import {Outlet, useModel} from '@umijs/max'
import {useRouteProps} from '@umijs/max'
import {toLogin} from '@/utils/authority'

export default function Layout() {
  const routeProps = useRouteProps()
  const {initialState} = useModel('@@initialState')
  const {currentUser} = initialState || {}
  // @ts-ignore
  //console.log(window.__POWERED_BY_WUJIE__, routeProps.authority, currentUser)
  if (routeProps.authority && !currentUser) {
    return toLogin()
  }
  return <div className='app-main'><Outlet/></div>
}
