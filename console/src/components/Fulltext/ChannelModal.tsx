import React from 'react'
import { Modal, Button, Space, Typography } from 'antd'
import { FileTextOutlined, SendOutlined } from '@ant-design/icons'

const { Text, Title } = Typography

interface ChannelModalProps {
  open: boolean
  onClose: () => void
  title?: string
  ppvLink?: string
  onDDSApply: () => void
  onPPVOpen: () => void
}

const ChannelModal: React.FC<ChannelModalProps> = ({
  open,
  onClose,
  title,
  ppvLink,
  onDDSApply,
  onPPVOpen,
}) => {
  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      centered
      title='选择获取全文的方式'
      width={480}
    >
      {title && (
        <div style={{ marginBottom: 20, fontSize: 14 }}>
          <Text strong>资源：</Text>
          <Text>{title}</Text>
        </div>
      )}
      <div style={{ marginBottom: 16, color: '#666', fontSize: 13 }}>
        该资源暂未在本地馆藏和OA中找到全文，您可以通过以下方式获取：
      </div>
      <Space direction='vertical' style={{ width: '100%' }} size={16}>
        <div
          style={{
            border: '1px solid #d9d9d9',
            borderRadius: 8,
            padding: 16,
            cursor: 'pointer',
          }}
          onClick={onDDSApply}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <SendOutlined style={{ fontSize: 24, color: '#1677ff' }} />
            <div>
              <Title level={5} style={{ margin: 0 }}>
                CADAL 文献传递
              </Title>
              <Text type='secondary'>
                通过CADAL网关向合作图书馆申请文献传递，全文将发送到您的邮箱
              </Text>
            </div>
          </div>
        </div>
        {ppvLink && (
          <div
            style={{
              border: '1px solid #d9d9d9',
              borderRadius: 8,
              padding: 16,
              cursor: 'pointer',
            }}
            onClick={onPPVOpen}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <FileTextOutlined style={{ fontSize: 24, color: '#52c41a' }} />
              <div>
                <Title level={5} style={{ margin: 0 }}>
                  按篇付费（PPV）
                </Title>
                <Text type='secondary'>
                  直接通过机构付费获取全文，无需等待
                </Text>
              </div>
            </div>
          </div>
        )}
      </Space>
    </Modal>
  )
}

export default ChannelModal