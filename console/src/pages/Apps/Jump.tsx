import React, {useEffect, useState} from 'react'
import {useParams, history, useModel} from '@umijs/max'
import WujieReact from 'wujie-react'
import {getCommonProps} from '@/utils/wujie'

const Jump: React.FC = () => {
  const [clientInfo, setClientInfo] = useState<APPAPI.ClientPublic | undefined>()
  const params = useParams()
  const {initialState} = useModel('@@initialState')

  useEffect(() => {
    if (!params.clientCode || !initialState?.toShowClients?.length) {
      return history.push('/404')
    }
    let curClient = initialState.toShowClients.find((_: APPAPI.ClientPublic) => _.clientCode === params.clientCode)
    if (!curClient) {
      return history.push('/404')
    }
    setClientInfo(curClient)
  }, [params.clientCode, initialState?.toShowClients])

  if (!clientInfo) {
    return null
  }
  let visitPath = clientInfo.endpoints?.find((_) => _.endpointType === 'pc')?.visitPath
  if (visitPath) {
    return (
      <WujieReact
        width='100%'
        height='100%'
        name={clientInfo.clientCode}
        url={visitPath}
        sync={true}
        props={getCommonProps()}
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
  visitPath = clientInfo.endpoints?.find((_) => _.endpointType === 'pcIframe')?.visitPath
  if (visitPath) {
    return (
      <iframe
        src={visitPath}
        style={{width: '100%', height: 'calc(100% - 3px)'}}
        frameBorder='0'
        allow='microphone'>
      </iframe>
    )
  }

  return null
}

export default Jump
