import React from 'react'
import ClientList from '@/pages/Client/List'
import {history} from '@@/core/history'

const MyClientList: React.FC = () => {
  const apiRelativeUrls: any = {
    getClientList: '/core/client-my/list',
    addClient: '/core/client/add',
    updateClient: '/core/client-my/update',
    deleteClient: '/core/client-my/delete',
    enableClient: '/core/client-my/enable',
    disableClient: '/core/client-my/disable',
    getClient: '/core/client-my/detail',
    getUcenterClient: '/core/client-my/ucenter/detail',
    saveUcenterClient: '/core/client-my/ucenter/save',
    getClientModuleList: '/core/client-my/module/list',
    addClientModule: '/core/client-my/module/add',
    deleteClientModule: '/core/client-my/module/delete',
    getClientPageConfigList: '/core/client-my/page/list',
    saveClientPageConfig: '/core/client-my/page/save',
    getClientPrivList: '/core/client-my/priv/list',
    addClientPriv: '/core/client-my/priv/add',
    deleteClientPriv: '/core/client-my/priv/delete',
    getGroupPrivsList: '/core/client-my/priv/group/list',
    saveGroupPrivs: '/core/client-my/priv/group/save-priv',
    getOtherClientPrivsList: '/core/client-my/priv/other-client/list',
    saveOtherClientPrivs: '/core/client-my/priv/other-client/save-priv',
  }
  return (
    <ClientList apiRelativeUrls={apiRelativeUrls} toDetail={(clientCode: string) => {
      history.push(`/my-client/detail/${clientCode}`)
    }}/>
  )
}

export default MyClientList
