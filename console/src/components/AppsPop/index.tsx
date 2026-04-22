import React from 'react'
import {Avatar, Button, Drawer, Input, Segmented, Tabs, Typography} from 'antd'
import {useModel} from '@@/exports'
import {CloseOutlined, SearchOutlined} from '@ant-design/icons'
import {ProList} from '@ant-design/pro-components'
import {createStyles} from 'antd-style'
import {history} from '@umijs/max'
import {checkPermissions} from '@/utils/authority'
import {getDocHttpUrl} from '@/utils/util'

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

  const {styles} = useStyles()

  return (
    <Drawer
      className={styles.container}
      title={
        <div style={{display: 'flex', alignItems: 'center', gap: 12, fontWeight: 500}}>
          <Segmented
            defaultValue='all'
            options={[
              {label: '全部应用', value: 'all'},
              {label: '文献服务', value: 'literature'},
              {label: '教学服务', value: 'teaching'},
              {label: '工具箱', value: 'tools'}
            ]}/>
          <Input placeholder='请输入关键词' variant='underlined' prefix={<SearchOutlined/>}/>
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
            dataIndex: 'logoUrl',
            listSlot: 'avatar',
          },
          {
            dataIndex: 'description',
            listSlot: 'content',
          },
        ]}
        dataSource={(initialState?.toShowClients || []).filter((clientInfo) => {
          let authority = clientInfo.needAuth2Show ? [`${clientInfo.clientCode}-browse`] : false
          return checkPermissions(authority, currentUser?.privs)
        })}
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
                  {item.description}
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
