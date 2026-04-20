import {Outlet, useModel} from '@umijs/max'
import {ConfigProvider, theme} from 'antd'
import {useRouteProps} from '@umijs/max'
import {toLogin} from '@/utils/authority'
import AppsPop from '@/components/AppsPop'
import {useEffect} from 'react'

export default function Layout() {
  useEffect(() => {
    // @ts-ignore
    const _mtm = window._mtm = window._mtm || []
    _mtm.push({'mtm.startTime': (new Date().getTime()), 'event': 'mtm.Start'})
    const d = document, g = d.createElement('script'), s = d.getElementsByTagName('script')[0]
    g.async = true
    g.src = 'https://mtm.jtxuexi.com/js/container_gHsUBGLC.js'
    // @ts-ignore
    s.parentNode.insertBefore(g, s)
  }, [])

  const routeProps = useRouteProps()
  const {initialState} = useModel('@@initialState')
  const {currentUser} = initialState || {}
  if (routeProps.authority && !currentUser) {
    return toLogin()
  }
  return <div className='app-main'><Outlet/><AppsPop/></div>
}
