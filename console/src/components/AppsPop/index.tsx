import React from 'react'
import {Button, Drawer, Typography} from 'antd'
import {useModel} from '@@/exports'
import {CloseOutlined} from '@ant-design/icons'
import {ProList} from '@ant-design/pro-components'
import {createStyles} from 'antd-style'
import {history} from '@umijs/max'

const {Text} = Typography

export type AppsPopProps = {
  style?: React.CSSProperties | undefined;
}

const useStyles = createStyles(({token}) => {
  return {
    container: {
      '& .ant-pro-checkcard .ant-pro-checkcard-body': {
        padding: '12px !important',
        color: 'rgba(0, 0, 0, 0.5)'
      },
      '& .ant-pro-checkcard .ant-pro-checkcard-content': {
        paddingBottom: '0 !important'
      },
      '& .ant-pro-checkcard': {
        cursor: 'default',
        minHeight: '85px',
        margin: 0
      }
    },
  }
})

const AppsPop: React.FC<AppsPopProps> = (props) => {
  const {appsPopOpened, setAppsPopOpened} = useModel('appsPop')
  const {initialState} = useModel('@@initialState')

  const {styles} = useStyles()

  return (
    <Drawer
      title='全部应用'
      placement='left'
      closable={false}
      onClose={() => {
        setAppsPopOpened(false)
      }}
      open={appsPopOpened}
      rootStyle={{
        top: '64px'
      }}
      width='800px'
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
        className={styles.container}
        ghost={true}
        itemCardProps={{
          ghost: true,
        }}
        rowSelection={false}
        grid={{gutter: 16, column: 2}}
        metas={{
          title: {
            dataIndex: 'clientName',
            render: (text, record) => {
              return (
                <Text
                  ellipsis={{tooltip: record.clientName}}
                >
                  <a onClick={() => {
                    setAppsPopOpened(false)
                    history.push(`/sub/${record.clientCode}`)
                  }}>{record.clientName}</a>
                </Text>
              )
            }
          },
          content: {
            dataIndex: 'description',
            render: (text, record) => {
              return (
                <Text
                  ellipsis={{tooltip: record.description}}
                >
                  {record.description}
                </Text>
              )
            }
          },
        }}
        dataSource={initialState?.toShowClients || []}
      />
    </Drawer>
  )
}

export default AppsPop
