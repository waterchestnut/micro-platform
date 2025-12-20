import {useModel, history} from '@umijs/max'
import {theme} from 'antd'
import React from 'react'
import WujieReact from 'wujie-react'
import {getCommonProps} from '@/utils/wujie'

const App: React.FC = () => {
  const {token} = theme.useToken()
  const {initialState} = useModel('@@initialState')
  const props = getCommonProps()
  return (
    // 保活模式，name相同则复用一个子应用实例，改变url无效，必须采用通信的方式告知路由变化
    <iframe
      src='https://www.jtxuexi.com/'
      style={{width: '100%', height: 'calc(100% - 3px)'}}
      frameBorder='0'
      allow='microphone'>
    </iframe>
  )
}

export default App
