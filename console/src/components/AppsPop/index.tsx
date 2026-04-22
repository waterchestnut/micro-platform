import React, {useMemo, useState} from 'react'
import {Avatar, Button, Drawer, Input, Segmented, Tabs, Tooltip, Typography} from 'antd'
import {useModel} from '@@/exports'
import {CloseOutlined, SearchOutlined} from '@ant-design/icons'
import {ProList} from '@ant-design/pro-components'
import {createStyles} from 'antd-style'
import {history} from '@umijs/max'
import {checkPermissions} from '@/utils/authority'
import {getDocHttpUrl} from '@/utils/util'
// @ts-ignore
import type {APPAPI} from '@/services/app/typings'

const {Text} = Typography

export type AppsPopProps = {
  style?: React.CSSProperties | undefined;
}

const useStyles = createStyles(({token, css}) => {
  return {
    container: {
      '.ant-avatar-image': {
        background: 'var(--ant-color-text-placeholder)',
      },
    },
    itemCon: {
      width: '100%',
      minWidth: 0,
      padding: 12,
      height: '100%',
      cursor: 'normal',
    },
    itemDes: {
      color: token.colorTextSecondary,
      fontSize: 14,
      lineHeight: 1.5,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      display: '-webkit-box',
      WebkitLineClamp: 2,
      WebkitBoxOrient: 'vertical',
    }
  }
})

const AppsPop: React.FC<AppsPopProps> = (props) => {
  const {appsPopOpened, setAppsPopOpened} = useModel('appsPop')
  const {initialState} = useModel('@@initialState')
  const {currentUser} = initialState || {}

  const [filterCategory, setFilterCategory] = useState<string>('all')
  const [searchKeyword, setSearchKeyword] = useState<string>('')

  const {styles} = useStyles()

  const filteredClients = useMemo(() => {
    let clients = (initialState?.toShowClients || []) as APPAPI.ClientPublic[]
    clients = clients.filter((clientInfo) => {
      let authority = clientInfo.needAuth2Show ? [`${clientInfo.clientCode}-browse`] : false
      return checkPermissions(authority, currentUser?.privs)
    })
    if (filterCategory !== 'all') {
      clients = clients.filter((client) => {
        const tags = client.tags || []
        return tags.some((tag: APPAPI.Tag) => tag.key === filterCategory)
      })
    }
    if (searchKeyword.trim()) {
      const keyword = searchKeyword.trim().toLowerCase()
      clients = clients.filter((client) => {
        if (client.clientName?.toLowerCase().includes(keyword)) return true
        if (client.description?.toLowerCase().includes(keyword)) return true
        const tags = client.tags || []
        return tags.some((tag: APPAPI.Tag) => tag.value?.toLowerCase().includes(keyword))
      })
    }
    return clients
  }, [initialState?.toShowClients, currentUser?.privs, filterCategory, searchKeyword])

  return (
    <Drawer
      className={styles.container}
      title={
        <div style={{display: 'flex', alignItems: 'center', gap: 12, fontWeight: 500}}>
          <Segmented
            value={filterCategory}
            onChange={(val) => setFilterCategory(val as string)}
            options={[
              {label: '全部应用', value: 'all'},
              {label: '文献服务', value: 'literature'},
              {label: '教学服务', value: 'teaching'},
              {label: '工具箱', value: 'tools'}
            ]}/>
          <Input
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            placeholder='请输入关键词'
            variant='underlined'
            prefix={<SearchOutlined/>}/>
        </div>
      }
      placement='left'
      closable={false}
      onClose={() => {
        setAppsPopOpened(false)
      }}
      open={appsPopOpened}
      rootStyle={{
        top: '64px'
      }}
      styles={{
        header: {
          padding: '12px 56px 12px 16px',
        },
        body: {
          padding: '0 12px',
        },
      }}
      size='800'
      extra={
        <Button
          type='text'
          onClick={() => {
            setAppsPopOpened(false)
          }}
          style={{
            height: '56px',
            position: 'absolute',
            right: 0,
            top: 0,
            borderRadius: 0
          }}
        ><CloseOutlined/></Button>
      }
    >
      <ProList<any>
        rowSelection={false}
        ghost={true}
        itemCardProps={{
          ghost: true,
        }}
        grid={{gutter: 16, column: 2}}
        columns={[
          {
            dataIndex: 'clientName',
            listSlot: 'title',
          },
          {
            dataIndex: 'description',
            listSlot: 'content',
          },
        ]}
        dataSource={filteredClients}
        itemRender={(item) => (
          <div
            className={styles.itemCon}
          >
            <div style={{display: 'flex', alignItems: 'flex-start', gap: 12}}>
              <Avatar
                src={getDocHttpUrl(item.logoUrl)}
                shape='square'
                size={48}
                style={{flexShrink: 0}}
              />
              <div style={{flex: 1, minWidth: 0}}>
                <div
                  style={{
                    fontWeight: 500,
                    fontSize: 16,
                    marginBottom: 4,
                  }}
                >
                  <a onClick={() => {
                    setAppsPopOpened(false)
                    history.push(`/sub/${item.clientCode}`)
                  }}>{item.clientName}</a>
                </div>
                <div
                  className={styles.itemDes}
                >
                  <Tooltip title={item.description}>
                    {item.description}
                  </Tooltip>
                </div>
              </div>
            </div>
          </div>
        )}
      />
    </Drawer>
  )
}

export default AppsPop
