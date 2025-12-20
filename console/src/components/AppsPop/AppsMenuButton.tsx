import {CloseOutlined, MenuOutlined} from '@ant-design/icons'
import React from 'react'
import {useModel} from '@umijs/max'
import {Button} from 'antd'
import RcQueueAnim from 'rc-queue-anim'

export type AppsMenuButtonProps = {
  style?: React.CSSProperties | undefined;
}

const AppsMenuButton: React.FC<AppsMenuButtonProps> = (props) => {
  const {appsPopOpened, setAppsPopOpened} = useModel('appsPop')

  return (
    <Button
      type='text'
      style={{
        height: '100%',
        fontSize: '20px',
        color: '#fff',
        marginRight: '-12px',
        borderRadius: 0,
        width: '52px'
      }}
      onClick={() => {
        setAppsPopOpened(!appsPopOpened)
      }}
    >
      {
        !appsPopOpened ? <MenuOutlined key='open'/> :
          <RcQueueAnim
            animConfig={[
              {opacity: [1, 0], translateY: [0, 50]},
              {opacity: [1, 0], translateY: [0, -50]}
            ]}
          >
            <CloseOutlined key='close'/>
          </RcQueueAnim>
      }
    </Button>
  )
}

export default AppsMenuButton
