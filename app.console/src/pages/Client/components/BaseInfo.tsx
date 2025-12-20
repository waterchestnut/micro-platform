import React, {ForwardRefRenderFunction, useEffect, useImperativeHandle, useRef, useState} from 'react'
import {
  ProCard,
  ProForm, ProFormDigit,
  ProFormGroup,
  ProFormInstance,
  ProFormList, ProFormSelect, ProFormSwitch, ProFormText, ProFormTextArea, ProFormUploadButton
} from '@ant-design/pro-components'
import {formatUploadFile, isArray, waitTime} from '@/utils/util'
import {errorMessage, successMessage} from '@/utils/msg'
import {addClient, updateClient} from '@/services/app/client'
import {Button, Col, Row, Space, Upload} from 'antd'
import StatusEnum from '@/enum/StatusEnum'
import ClientTypeEnum from '@/enum/ClientTypeEnum'
import EndpointTypeEnum from '@/enum/EndpointTypeEnum'
import {domainPattern} from '@/utils/validator'
import {getAccessToken} from '@/utils/authority'

export type BaseInfoProps = {
  onEditFinish?: (resData?: any) => Promise<void>;
  onEditCancel?: () => void;
  pClientInfo?: any;
  apiRelativeUrls?: any;
};

export type BaseInfoAction = {
  show: (record?: any) => void;
  close: () => void;
}

const formItemLayout =
  {
    labelCol: {span: 4},
    wrapperCol: {span: 20},
  }

const inlineItemLayout = {
  labelCol: {span: 8},
  wrapperCol: {span: 16},
}

const BaseInfo: ForwardRefRenderFunction<BaseInfoAction, BaseInfoProps> = (props, ref) => {
  const {onEditFinish, onEditCancel, pClientInfo, apiRelativeUrls} = props
  const [editing, setEditing] = useState(false)
  const [clientInfo, setClientInfo] = useState<any>(null)
  const formRef = useRef<ProFormInstance>()

  const resetForm = (info: any) => {
    waitTime(200).then(() => {
      if (info) {
        info.logoUrl = isArray(info.logoUrl) ? info.logoUrl : info.logoUrl ? [{
          uid: '-1',
          url: info.logoUrl
        }] : []
        formRef?.current?.setFieldsValue(info)
      } else {
        formRef?.current?.resetFields()
      }
    })
  }

  useEffect(() => {
    setClientInfo(pClientInfo)
    resetForm(pClientInfo)
  }, [pClientInfo])

  const handleOk = async () => {
    try {
      await formRef?.current?.validateFields()
    } catch (e) {
      console.error(e)
      return
    }
    let formData = formRef?.current?.getFieldsFormatValue?.(true)
    formData.logoUrl = formatUploadFile(formData.logoUrl).find(_ => _.status === 'done')?.url || ''
    //return console.log(formData)
    let ret
    let tip
    if (clientInfo) {
      ret = await updateClient(formData, apiRelativeUrls?.updateClient)
      tip = '修改应用'
    } else {
      ret = await addClient(formData, apiRelativeUrls?.addClient)
      tip = '添加应用'
    }
    if (ret.code !== 0) {
      let msg = ret.msg || tip + '失败，请稍后再试'
      return errorMessage(msg)
    }

    if (onEditFinish) {
      await onEditFinish()
    }
    successMessage(tip + '成功')
    setEditing(false)
  }

  const handleCancel = () => {
    setEditing(false)

    if (onEditCancel) {
      onEditCancel()
    }
  }

  useImperativeHandle(ref, () => ({
    show: async (info: any) => {
      setClientInfo(info || null)
      resetForm(info)
      setEditing(!info?.viewer)
    },
    close: () => {
      handleCancel()
    }
  }))

  return (
    <ProForm
      layout={'horizontal'}
      onFinish={async () => {
        await handleOk()
      }}
      formRef={formRef}
      {...formItemLayout}
      grid={true}
      labelWrap={true}
      readonly={clientInfo?.viewer || !editing}
      submitter={clientInfo?.viewer ? false : {
        render: (props, doms) => {
          return (
            <Row>
              <Col span={formItemLayout.wrapperCol.span} offset={formItemLayout.labelCol.span}>
                {
                  editing ? <Space>
                    <Button type='default' onClick={() => {
                      handleCancel()
                    }}>取消</Button>
                    <Button type='primary' onClick={() => {
                      handleOk()
                    }}>提交</Button>
                  </Space> : <Button type='default' onClick={() => {
                    setEditing(true)
                  }}>修改</Button>
                }
              </Col>
            </Row>
          )
        },
      }}
    >
      <ProFormText
        name='clientCode'
        label='应用标识'
        rules={[
          {
            required: true,
            message: '请输入应用标识',
          },
        ]}
        readonly={clientInfo?.viewer || clientInfo?.clientCode}
      />
      <ProFormText
        name='clientName'
        label='应用名称'
        rules={[
          {
            required: true,
            message: '请输入应用名称',
          },
        ]}
      />
      <ProFormUploadButton
        label='图标'
        name='logoUrl'
        title='选择图片'
        max={1}
        fieldProps={{
          name: 'logo',
          listType: 'picture-card',
          accept: '.png, .jpg, .jpeg',
          beforeUpload: (file) => {
            const isJpgOrPng = file.type === 'image/jpeg' || file.type === 'image/png'
            if (!isJpgOrPng) {
              errorMessage('仅支持PNG、JPG格式的图片，且文件大小不超过300K。')
            }
            const isLt = file.size / 1024 < 300
            if (!isLt) {
              errorMessage('仅支持PNG、JPG格式的图片，且文件大小不超过300K。')
            }
            return (isJpgOrPng && isLt) || Upload.LIST_IGNORE
          },
          headers: {'param-accessToken': getAccessToken()},
          onRemove: (file) => {
            return !(clientInfo?.viewer || !editing)
          }
        }}  // @ts-ignore
        action={DOC_API_BASE + '/file/upload/simple'}
        extra='支持PNG、JPG的正方形图片，文件大小不超过300K。'
        onChange={({file, fileList}) => {
          if (file.response && file.response.code !== 0) {
            file.status = 'error'
            errorMessage('上传失败：' + (file.response.msg || '请稍后再试'))
            fileList.splice(fileList.findIndex(_ => _.uid === file.uid), 1)
          }
        }}
      />
      {
        clientInfo?.clientCode ?
          <ProFormSelect
            name='status'
            label='状态'
            readonly
            options={StatusEnum.toOptions()}
          /> : null
      }
      <ProFormSelect
        name='clientType'
        label='应用类型'
        readonly
        options={ClientTypeEnum.toOptions()}
      />
      <ProFormSwitch
        name='needAuth2Show'
        label='分配权限后显示'
        tooltip='开启后，只有拥有“进入应用”权限的用户才会看到本应用的入口'
        initialValue={true}
      />
      <ProFormDigit
        name='order'
        label='默认展示顺序'
      />
      <ProFormSwitch
        name='needAuthProxy'
        label='代理权限验证'
        tooltip='开启后，结合应用配置中的“API路由”管理，委托授权中心验证接口权限'
        initialValue={true}
      />
      <ProFormList
        name='endpoints'
        label='访问端'
        creatorButtonProps={{
          creatorButtonText: '添加访问端',
        }}
        copyIconProps={{tooltipText: '复制'}}
        deleteIconProps={{tooltipText: '删除'}}
        itemRender={({listDom, action}, {index}) => (
          <ProCard
            bordered
            style={{marginBlockEnd: 8}}
            extra={action}
            bodyStyle={{paddingBlockEnd: 0}}
          >
            {listDom}
          </ProCard>
        )}
        rowProps={
          {style: {margin: 0}}
        }
      >
        <ProFormGroup>
          <ProFormSelect
            name='endpointType'
            label='类型'
            rules={[
              {
                required: true,
                message: '请选择类型',
              },
            ]}
            options={EndpointTypeEnum.toOptions()}
            colProps={{span: 12}}
            {...inlineItemLayout}
          />
          <ProFormText
            name='visitPath'
            label='地址'
            rules={[
              {
                required: true,
                message: '请输入访问地址',
              },
            ]}
            colProps={{span: 12}}
            {...inlineItemLayout}
          />
        </ProFormGroup>
      </ProFormList>
      <ProFormList
        name='upstreams'
        label='接口上游'
        creatorButtonProps={{
          creatorButtonText: '添加上游',
        }}
        copyIconProps={{tooltipText: '复制'}}
        deleteIconProps={{tooltipText: '删除'}}
        itemRender={({listDom, action}, {index}) => (
          <ProCard
            bordered
            style={{marginBlockEnd: 8}}
            extra={action}
            bodyStyle={{paddingBlockEnd: 0}}
          >
            {listDom}
          </ProCard>
        )}
        rowProps={
          {style: {margin: 0}}
        }
      >
        <ProFormGroup>
          <ProFormText
            name='host'
            label='主机(含端口)'
            rules={[
              {
                required: true,
                message: '请输入主机地址',
              },
              {pattern: domainPattern, message: '请输入正确的主机地址'},
            ]}
            colProps={{span: 12}}
            {...inlineItemLayout}
          />
          <ProFormDigit
            name='weight'
            label='权重'
            initialValue={1}
            rules={[
              {
                required: true,
                message: '请输入权重',
              },
            ]}
            colProps={{span: 12}}
            {...inlineItemLayout}
          />
        </ProFormGroup>
      </ProFormList>
      <ProFormTextArea
        name='description'
        label='应用描述'
      />
      <ProFormList
        name='tags'
        label='标签'
        creatorButtonProps={{
          creatorButtonText: '添加标签',
        }}
        copyIconProps={{tooltipText: '复制'}}
        deleteIconProps={{tooltipText: '删除'}}
        itemRender={({listDom, action}, {index}) => (
          <ProCard
            bordered
            style={{marginBlockEnd: 8}}
            extra={action}
            bodyStyle={{paddingBlockEnd: 0}}
          >
            {listDom}
          </ProCard>
        )}
        rowProps={
          {style: {margin: 0}}
        }
      >
        <ProFormGroup>
          <ProFormText
            name='key'
            label='标签名'
            rules={[
              {
                required: true,
                message: '请输入标签名',
              },
            ]}
            colProps={{span: 12}}
            {...inlineItemLayout}
          />
          <ProFormText
            name='value'
            label='标签值'
            rules={[
              {
                required: true,
                message: '请输入标签值',
              },
            ]}
            colProps={{span: 12}}
            {...inlineItemLayout}
          />
        </ProFormGroup>
      </ProFormList>
    </ProForm>
  )
}

export default React.forwardRef(BaseInfo)
