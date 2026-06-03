import {Outlet, useModel} from '@umijs/max'
import {ConfigProvider, theme} from 'antd'
import {useRouteProps} from '@umijs/max'
import {toLogin} from '@/utils/authority'

export default function LayoutLite() {
  const routeProps = useRouteProps()
  const {initialState} = useModel('@@initialState')
  const {currentUser} = initialState || {}
  if (routeProps.authority && !currentUser) {
    return toLogin()
  }
  return <div className='app-main-lite'>
    <ConfigProvider
      theme={{
        components: {}
      }}
    >
      <Outlet/>
    </ConfigProvider>
  </div>
}
