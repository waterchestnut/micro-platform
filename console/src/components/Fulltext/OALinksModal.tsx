import React from 'react'
import { Modal, List, Typography, Alert } from 'antd'
import { LinkOutlined } from '@ant-design/icons'

const { Text } = Typography

interface OALinksModalProps {
  open: boolean
  onClose: () => void
  title?: string
  links: { href: string; label?: string }[]
}

const OALinksModal: React.FC<OALinksModalProps> = ({ open, onClose, title, links }) => {
  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      centered
      title='选择 OA 全文链接'
      width={560}
    >
      {title && (
        <div style={{ marginBottom: 16, fontSize: 14 }}>
          <Text strong>资源：</Text>
          <Text>{title}</Text>
        </div>
      )}
      <List
        dataSource={links}
        renderItem={(link, index) => (
          <List.Item>
            <a
              href={link.href}
              target='_blank'
              rel='noopener noreferrer'
              style={{ display: 'flex', alignItems: 'center', gap: 8 }}
            >
              <LinkOutlined />
              <Text>{link.label || `链接 ${index + 1}：${link.href}`}</Text>
            </a>
          </List.Item>
        )}
      />
      <Alert
        message='上述全文链接可能会依据版权方要求变化，如果某个链接失效，您可以尝试其他链接'
        type='info'
        showIcon
        style={{ marginTop: 16 }}
      />
    </Modal>
  )
}

export default OALinksModal