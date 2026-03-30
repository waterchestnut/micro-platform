import {useModel, history} from '@umijs/max'
import {theme} from 'antd'
import React from 'react'
import WujieReact from 'wujie-react'
import {getCommonProps} from '@/utils/wujie'

const BorrowDD: React.FC = () => {
  const {token} = theme.useToken()
  const {initialState} = useModel('@@initialState')
  const props = getCommonProps()
  //@ts-ignore
  const baseUrl = UCENTER_PLATFORM_BASE
  return (
    // 保活模式，name相同则复用一个子应用实例，改变url无效，必须采用通信的方式告知路由变化
    <WujieReact
      width='100%'
      height='100%'
      name='ucenter'
      url={baseUrl + '/lite/personal/setting'}
      sync={true}
      props={props}
      plugins={[
        {
          windowPropertyOverride: (subWindow: typeof window) =>
            Object.defineProperty(subWindow.Navigator.prototype, 'clipboard', {
              get: () => {
                // @ts-ignore
                return subWindow.__POWERED_BY_WUJIE__ ? subWindow.parent.navigator.clipboard : subWindow.navigator.clipboard
              },
            }),
        },
      ]}
    ></WujieReact>
  )
}

export default BorrowDD
