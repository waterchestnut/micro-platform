import React from 'react'
import { Modal, Spin } from 'antd'
import { LoadingOutlined } from '@ant-design/icons'

interface SchedulingModalProps {
  open: boolean
}

const SchedulingModal: React.FC<SchedulingModalProps> = ({ open }) => {
  return (
    <Modal
      open={open}
      footer={null}
      closable={false}
      centered
      mask={{ closable: false }}
      width={320}
      styles={{
        body: {
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px 24px',
        },
      }}
    >
      <Spin indicator={<LoadingOutlined style={{ fontSize: 36 }} spin />} />
      <div style={{ marginTop: 20, fontSize: 15, color: '#333' }}>
        正在为您调度全文资源，请稍候...
      </div>
    </Modal>
  )
}

export default SchedulingModal