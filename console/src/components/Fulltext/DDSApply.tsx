import React, { useState } from 'react'
import {
  Modal,
  Form,
  Input,
  Radio,
  Checkbox,
  Button,
  Space,
  Typography,
  message,
} from 'antd'
import { MailOutlined } from '@ant-design/icons'

const { Title, Text } = Typography

interface DDSApplyProps {
  open: boolean
  onClose: () => void
  detail?: any
  title?: string
  onApply?: (values: any) => void
  ddsServiceType?: 'dd' | 'ill'
}

const DDSApply: React.FC<DDSApplyProps> = ({
  open,
  onClose,
  detail,
  title,
  onApply,
  ddsServiceType = 'dd',
}) => {
  const [form] = Form.useForm()
  const [strategy, setStrategy] = useState<'free' | 'speed' | ''>('')
  const [getMore, setGetMore] = useState(false)
  const [onlyFree, setOnlyFree] = useState(false)

  const isDD = ddsServiceType === 'dd'
  const serviceName = isDD ? '文献传递' : '馆际互借'

  const handleApply = async () => {
    try {
      const values = await form.validateFields()
      message.success(`${serviceName}申请已提交，请等待审核处理`)
      onApply?.({
        ...values,
        title: detail?.title,
        isbn: detail?.isbn,
        doi: detail?.doi,
        serviceType: ddsServiceType,
      })
      onClose()
    } catch (e) {
      console.error(e)
    }
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={[
        <Button key='cancel' onClick={onClose}>
          取消
        </Button>,
        <Button key='apply' type='primary' onClick={handleApply}>
          申请
        </Button>,
      ]}
      width={700}
      centered
      title={`${serviceName}申请`}
    >
      <Form form={form} layout='horizontal'>
        <Form.Item
          label={
            <span>
              <MailOutlined style={{ marginRight: 4 }} />
              请输入您接收文献的邮箱
            </span>
          }
          name='email'
          rules={[
            { required: true, message: '请输入邮箱地址' },
            { type: 'email', message: '请输入有效的邮箱地址' },
          ]}
        >
          <Input style={{ width: 400 }} placeholder='example@email.com' />
        </Form.Item>
      </Form>

      <div style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
        您可以直接使用默认策略进行申请，也可以根据具体需求调整合适的申请策略。
      </div>

      <div
        style={{
          fontSize: 13,
          color: '#666',
          marginBottom: 16,
          lineHeight: 1.6,
        }}
      >
        <div>
          1. 免费优先：将所有无需个人付费的渠道排在前面，再根据历史响应速度优化排序，如果您不希望支付费用，可勾选"仅限免费"项，申请策略将排除所有需要个人付费的渠道，但这将降低成功获取资源的概率；
        </div>
        <div>
          2. 速度优先：不考虑是否个人付费，仅依照历史统计的响应速率排序，请注意，这个排序不代表本次申请的真实速率，仅为历史统计值供参考；
        </div>
        <div>
          3. 尽量获取：CADAL 提供如 Rapido、Subito 等国际借阅服务，但可能会收取较多的费用，如您选择此项，在默认所有渠道均借阅失败的情况下，CADAL 会询问您是否使用这些渠道，请您随时关注进展；
        </div>
        <div>
          4. 仅限免费：勾选此项则排除所有需要个人收费的渠道，此项和"尽量获取"互斥，不能同时选择。
        </div>
        <div style={{ marginTop: 8 }}>
          无论您选择何种策略，均可以在此基础上自行调整，最终申请策略以您调整后的顺序为准。需要注意的是，如果您自行调整后再次调整"免费优先"等选择项，您之前的调整结果将会丢失，需要您重新调整。
        </div>
      </div>

      <Form.Item style={{ marginBottom: 16 }}>
        <Space size={24}>
          <Radio
            checked={strategy === 'free'}
            onChange={() => {
              setStrategy('free')
              setGetMore(false)
            }}
          >
            免费优先
          </Radio>
          <Radio
            checked={strategy === 'speed'}
            onChange={() => {
              setStrategy('speed')
              setGetMore(false)
            }}
          >
            速度优先
          </Radio>
          <Checkbox
            checked={getMore}
            onChange={(e) => {
              setGetMore(e.target.checked)
              if (e.target.checked) setOnlyFree(false)
            }}
            disabled={onlyFree}
          >
            尽量获取
          </Checkbox>
          <Checkbox
            checked={onlyFree}
            onChange={(e) => {
              setOnlyFree(e.target.checked)
              if (e.target.checked) setGetMore(false)
            }}
            disabled={getMore}
          >
            仅限免费
          </Checkbox>
        </Space>
      </Form.Item>
    </Modal>
  )
}

export default DDSApply
