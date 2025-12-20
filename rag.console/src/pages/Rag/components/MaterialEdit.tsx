import React, {createRef, ForwardRefRenderFunction, useImperativeHandle, useRef, useState} from 'react'
import {Button, Col, Modal, Row, Space, Upload} from 'antd'
import {ProForm, ProFormInstance, ProFormText, ProFormTextArea} from '@ant-design/pro-components'
import {errorMessage, successMessage} from '@/utils/msg'
import ProFormUploadDraggerWrapper from '@/components/Upload/ProFormUploadDraggerWrapper'
import {formatUploadFile, waitTime} from '@/utils/util'
import {addRagMaterial, updateRagMaterial} from '@/services/rag/ragMaterial'

export type MaterialEditProps = {
  pRagInfo?: any;
  onEditFinish?: (resData?: any) => Promise<void>;
  apiRelativeUrls?: any;
};

export type MaterialEditAction = {
  show: (record?: any) => void;
  close: () => void;
}

const formItemLayout =
  {
    labelCol: {span: 4},
    wrapperCol: {span: 20},
  }

const MaterialEdit: ForwardRefRenderFunction<MaterialEditAction, MaterialEditProps> = (props, ref) => {
  const {pRagInfo, onEditFinish, apiRelativeUrls} = props
  const [isOpen, setIsOpen] = useState(false)
  const [materialInfo, setMaterialInfo] = useState<any>(null)
  const formRef = useRef<ProFormInstance>()

  const handleCancel = () => {
    setIsOpen(false)
  }

  useImperativeHandle(ref, () => ({
    show: async (info: any) => {
      setMaterialInfo(info || null)
      waitTime(200).then(() => {
        if (info) {
          formRef?.current?.setFieldsValue(info)
        } else {
          formRef?.current?.resetFields()
        }
      })
      setIsOpen(true)
    },
    close: () => {
      handleCancel()
    }
  }))

  const handleOk = async () => {
    try {
      await formRef?.current?.validateFields()
      let formData = formRef?.current?.getFieldsFormatValue?.(true)
      //console.log(formData)
      formData.fileList = formatUploadFile(formData.fileList).filter(_ => _.status === 'done') || []
      //return console.log(formData)
      formData.ragCode = pRagInfo.ragCode
      let ret
      let tip
      if (materialInfo) {
        ret = await updateRagMaterial(formData, apiRelativeUrls?.updateRagMaterial)
        tip = '修改材料'
      } else {
        ret = await addRagMaterial(formData, apiRelativeUrls?.addRagMaterial)
        tip = '添加材料'
      }
      if (ret.code !== 0) {
        let msg = ret.msg || tip + '失败，请稍后再试'
        return errorMessage(msg)
      }

      if (onEditFinish) {
        await onEditFinish()
      }
      successMessage(tip + '成功')
      setIsOpen(false)
    } catch (e) {
      console.error(e)
      return
    }
  }

  return (
    <Modal
      title={(materialInfo ? materialInfo.viewer ? '查看' : '编辑' : '新建') + '知识库材料'}
      open={isOpen}
      onCancel={handleCancel}
      centered={true}
      destroyOnClose={true}
      forceRender={true}
      footer={null}
      width={900}
    >
      <ProForm
        layout={'horizontal'}
        onFinish={async () => {
          await handleOk()
        }}
        formRef={formRef}
        {...formItemLayout}
        grid={true}
        labelWrap={true}
        readonly={materialInfo?.viewer}
        submitter={materialInfo?.viewer ? false : {
          render: (props, doms) => {
            return (
              <Row>
                <Col span={formItemLayout.wrapperCol.span} offset={formItemLayout.labelCol.span}>
                  <Space>
                    <Button type='default' onClick={() => {
                      handleCancel()
                    }}>取消</Button>
                    <Button type='primary' onClick={() => {
                      handleOk()
                    }}>提交</Button>
                  </Space>
                </Col>
              </Row>
            )
          },
        }}
        onValuesChange={(changes: any) => {
          // console.log(changes)
          let resTitle = formRef?.current?.getFieldValue('resTitle')
          if (changes?.fileList?.[0]?.name && !resTitle) {
            formRef?.current?.setFieldValue('resTitle', changes.fileList[0].name)
          }
        }}
      >
        {
          materialInfo?.ragMaterialCode ?
            <ProFormText
              name='ragMaterialCode'
              label='材料标识'
              readonly={true}
            /> : null
        }
        <ProFormUploadDraggerWrapper
          label='材料文件'
          name='fileList'
          title='选择文件'
          max={1}
          extra='支持Office、PDF文件，文件大小不超过300M。'
          fileSize={300}
          fileExts={['.doc', '.docx', '.pdf']}
          rules={[
            {
              required: true,
              message: '请上传材料文件',
            },
          ]}
          readonly={materialInfo?.viewer || materialInfo?.ragMaterialCode}
        />
        <ProFormText
          name='resTitle'
          label='材料标题'
          rules={[
            {
              required: true,
              message: '请输入材料标题',
            },
          ]}
        />
        <ProFormTextArea
          name='description'
          label='材料描述'
        />
        <ProFormText
          name='resCode'
          label='源资源标识'
        />
        <ProFormText
          name='resOriginalUrl'
          label='源资源访问地址'
        />
      </ProForm>
    </Modal>
  )
}

export default React.forwardRef(MaterialEdit)
