import React, {createRef, useEffect, useState} from 'react'
import {PageContainer, ProCard} from '@ant-design/pro-components'
import BaseInfo, {BaseInfoAction} from '@/pages/Client/components/BaseInfo'
import {useParams, history} from '@umijs/max'
import {getClient} from '@/services/app/client'
import OauthManage from '@/pages/Client/components/OauthManage'
import ModuleManage from '@/pages/Client/components/ModuleManage'
import AuthManage from '@/pages/Client/components/AuthManage'
import ApiManage from '@/pages/Client/components/ApiManage'
import GroupManage from '@/pages/Client/components/GroupManage'
import OtherClientManage from '@/pages/Client/components/OtherClientManage'

export type ClientDetailProps = {
  apiRelativeUrls?: any;
  toBack?: (clientCode: string) => void;
};

const ClientDetail: React.FC<ClientDetailProps> = (props) => {
  const {apiRelativeUrls, toBack} = props
  const [activeKey, setActiveKey] = useState('base')
  const [clientInfo, setClientInfo] = useState<any>(null)
  const baseInfoRef = createRef<BaseInfoAction>()
  const [loading, setLoading] = useState<any>(true)
  const params = useParams()

  const loadClientInfo = async () => {
    if (!params.clientCode) {
      return history.push('/404')
    }
    setLoading(true)
    let info = await getClient(params.clientCode, apiRelativeUrls?.getClient)
    if (!info?.clientCode) {
      return history.push('/404')
    }
    setClientInfo(info)
    setLoading(false)
  }

  useEffect(() => {
    if (!params.clientCode) {
      return history.push('/404')
    }
    loadClientInfo()
  }, [params.clientCode])

  const renderContent = () => {
    if (activeKey === 'base') {
      return (
        <ProCard>
          <BaseInfo
            ref={baseInfoRef}
            onEditFinish={async () => {
              loadClientInfo()
            }}
            onEditCancel={() => {
            }}
            pClientInfo={clientInfo}
            apiRelativeUrls={apiRelativeUrls}
          />
        </ProCard>
      )
    }
    if (activeKey === 'oauth') {
      return (
        <OauthManage pClientInfo={clientInfo} apiRelativeUrls={apiRelativeUrls}/>
      )
    }
    if (activeKey === 'module') {
      return (
        <ModuleManage pClientInfo={clientInfo} apiRelativeUrls={apiRelativeUrls}/>
      )
    }
    if (activeKey === 'auth') {
      return (
        <AuthManage pClientInfo={clientInfo} apiRelativeUrls={apiRelativeUrls}/>
      )
    }
    if (activeKey === 'api') {
      return (
        <ApiManage pClientInfo={clientInfo} apiRelativeUrls={apiRelativeUrls}/>
      )
    }
    if (activeKey === 'group') {
      return (
        <GroupManage pClientInfo={clientInfo} apiRelativeUrls={apiRelativeUrls}/>
      )
    }
    if (activeKey === 'other-client') {
      return (
        <OtherClientManage
          pClientInfo={clientInfo}
          onEditFinish={async () => {
            loadClientInfo()
          }}
          apiRelativeUrls={apiRelativeUrls}
        />
      )
    }
    return null
  }

  return (
    <PageContainer
      loading={loading}
      tabList={[
        {
          tab: '基本信息',
          key: 'base',
        },
        {
          tab: 'OAUTH',
          key: 'oauth',
        },
        {
          tab: '模块管理',
          key: 'module',
        },
        {
          tab: '权限管理',
          key: 'auth',
        },
        {
          tab: 'API路由',
          key: 'api',
        },
        {
          tab: '用户赋权',
          key: 'group',
        },
        {
          tab: '其他应用赋权',
          key: 'other-client',
        },
      ]}
      header={{
        title: clientInfo?.clientName,
        onBack: () => {
          if (toBack) {
            toBack(params.clientCode + '')
          } else {
            history.push('/client/list')
          }
        }
      }}
      tabActiveKey={activeKey}
      onTabChange={(activeKey) => {
        setActiveKey(activeKey)
      }}
      className='tab-page-container'
    >
      {renderContent()}
    </PageContainer>
  )
}

export default ClientDetail
