/**
 * @fileOverview 管理应用弹层的开关状态
 * @author xianyang
 * @module
 */

import {useState} from 'react'

export default () => {
  const [appsPopOpened, setAppsPopOpened] = useState(false)

  return {
    appsPopOpened,
    setAppsPopOpened,
  }
}
