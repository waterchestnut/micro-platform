import React, {ForwardRefRenderFunction, useImperativeHandle, useRef, useState} from 'react'
import {
  ModalForm, ProCard, ProFormDatePicker,
  ProFormDependency, ProFormDigit,
  ProFormGroup,
  ProFormInstance,
  ProFormList, ProFormSelect,
  ProFormText
} from '@ant-design/pro-components'
import {waitTime} from '@/utils/util'
import {errorMessage, successMessage} from '@/utils/msg'
import {addUser, updateUser} from '@/services/ucenter/user'
import {Form, Input} from 'antd'
import {checkPasswordComplexity, emailPattern, mobilePattern} from '@/utils/validator'
import DegreeEnum from '@/enum/DegreeEnum'
import GenderEnum from '@/enum/GenderEnum'
import StatusEnum from '@/enum/StatusEnum'
import AuthTypeEnum from '@/enum/AuthTypeEnum'
import SchemaEnum from '@/enum/SchemaEnum'

export type EditProps = {
  onEditFinish?: (resData?: any) => Promise<void>;
};

export type EditAction = {
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

const Edit: ForwardRefRenderFunction<EditAction, EditProps> = (props, ref) => {
  const {onEditFinish} = props
  const [isOpen, setIsOpen] = useState(false)
  const [userInfo, setUserInfo] = useState<any>(null)
  const formRef = useRef<ProFormInstance>()

  const handleOk = async () => {
    try {
      await formRef?.current?.validateFields()
    } catch (e) {
      console.error(e)
      return
    }
    let formData = formRef?.current?.getFieldsFormatValue?.(true)
    let ret
    let tip
    if (userInfo) {
      ret = await updateUser(formData)
      tip = '修改用户'
    } else {
      ret = await addUser(formData)
      tip = '添加用户'
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
  }

  const handleCancel = () => {
    setIsOpen(false)
  }

  useImperativeHandle(ref, () => ({
    show: async (info: any) => {
      setUserInfo(info || null)
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

  return (
    <ModalForm
      title={(userInfo ? userInfo.viewer ? '查看' : '编辑' : '新建') + '用户'}
      open={isOpen}
      layout={'horizontal'}
      modalProps={
        {
          onCancel: handleCancel,
          centered: true,
          className: `modal-fixed ${userInfo?.viewer ? 'modal-no-footer' : ''}`,
          destroyOnClose: true,
          width: '60%'
        }
      }
      onFinish={async () => {
        await handleOk()
      }}
      formRef={formRef}
      {...formItemLayout}
      grid={true}
      readonly={userInfo?.viewer}
      submitter={userInfo?.viewer ? false : undefined}
    >
      <ProFormText
        name='userCode'
        label='用户标识'
        rules={[
          {
            required: true,
            message: '请输入用户标识',
          },
        ]}
        readonly={userInfo?.viewer || userInfo?.userCode}
      />
      <ProFormText
        name='realName'
        label='姓名'
        rules={[
          {
            required: true,
            message: '请输入姓名',
          },
        ]}
      />
      <ProFormText
        name='nickName'
        label='昵称'
      />
      <ProFormText
        name='mobile'
        label='手机'
      />
      <ProFormText
        name='email'
        label='邮箱'
      />
      <ProFormText.Password
        name='pwd'
        label='密码'
        rules={[
          () => ({
            validator(_, value) {
              if (!value || !value.length) {
                return Promise.resolve()
              }
              let checkRet = checkPasswordComplexity(value)
              if (!checkRet.lengthRegex) {
                return Promise.reject(new Error('密码长度不正确'))
              }
              if (checkRet.invalidRegex) {
                return Promise.reject(new Error('密码含有非法字符'))
              }
              if (!checkRet.requiredIsValid) {
                return Promise.reject(new Error('密码不符合包含规则'))
              }
              if (!checkRet.level) {
                return Promise.reject(new Error('密码强度弱，建议修改'))
              }
              return Promise.resolve()
            },
          }),
        ]}
        extra='密码由8-32位（大写字母、小写字母、数字、符号）组成，至少包含其中三项'
      />
      <ProFormDependency name={['pwd']}>
        {
          ({pwd}) => {
            if (!pwd) {
              return null
            }

            return (
              <ProFormText.Password
                name='pwd1'
                label='密码确认'
                rules={[
                  {
                    required: true,
                    message: '请再输一次新密码',
                  },
                  ({getFieldValue}) => ({
                    validator(_, value) {
                      if (!value || getFieldValue('pwd') === value) {
                        return Promise.resolve()
                      }

                      return Promise.reject(new Error('两次输入的密码不一致'))
                    },
                  }),
                ]}
              />
            )
          }
        }
      </ProFormDependency>
      <ProFormText
        name='avatarUrl'
        label='头像地址'
      />
      <ProFormList
        name='mobileList'
        label='联系手机'
        creatorRecord={() => {
          return String('')
        }}
        initialValue={['']}
        style={{marginBottom: 0}}
        creatorButtonProps={{
          creatorButtonText: '添加手机',
          type: 'link',
          style: {width: 'unset'},
        }}
        copyIconProps={false}
        deleteIconProps={{tooltipText: '删除'}}
        itemRender={({listDom, action}) => (
          <div
            style={{
              display: 'inline-flex',
              marginInlineEnd: 24,
            }}
          >
            {listDom}
            {action}
          </div>
        )}
      >
        {(field, idx) => {
          return (
            <Form.Item
              {...field}
              label={idx + 1}
              rules={[
                {
                  required: true,
                  message: '请输入手机号',
                },
                {pattern: mobilePattern, message: '请输入正确的手机号'},
                ({getFieldValue}) => ({
                  validator(_, value) {
                    if (!value || !value.length) {
                      return Promise.resolve()
                    }
                    let list = getFieldValue('mobileList')
                    let count = list?.filter((v: string) => v === value)?.length
                    if (count > 1) {
                      return Promise.reject(new Error('请勿重复输入'))
                    }
                    return Promise.resolve()
                  }
                })
              ]}
            >
              {
                userInfo?.viewer ?
                  <span>{userInfo.mobileList?.[idx] || '-'}</span> :
                  <Input/>
              }
            </Form.Item>
          )
        }
        }
      </ProFormList>
      <ProFormList
        name='emailList'
        label='联系邮箱'
        creatorRecord={() => {
          return String('')
        }}
        initialValue={['']}
        style={{marginBottom: 0}}
        creatorButtonProps={{
          creatorButtonText: '添加邮箱',
          type: 'link',
          style: {width: 'unset'},
        }}
        copyIconProps={false}
        deleteIconProps={{tooltipText: '删除'}}
        itemRender={({listDom, action}) => (
          <div
            style={{
              display: 'inline-flex',
              marginInlineEnd: 24,
            }}
          >
            {listDom}
            {action}
          </div>
        )}
      >
        {(field, idx) => {
          return (
            <Form.Item
              {...field}
              label={idx + 1}
              rules={[
                {
                  required: true,
                  message: '请输入邮箱',
                },
                {pattern: emailPattern, message: '请输入正确的邮箱'},
                ({getFieldValue}) => ({
                  validator(_, value) {
                    if (!value || !value.length) {
                      return Promise.resolve()
                    }
                    let list = getFieldValue('emailList')
                    let count = list?.filter((v: string) => v === value)?.length
                    if (count > 1) {
                      return Promise.reject(new Error('请勿重复输入'))
                    }
                    return Promise.resolve()
                  }
                })
              ]}
            >
              {
                userInfo?.viewer ?
                  <span>{userInfo.emailList?.[idx] || '-'}</span> :
                  <Input/>
              }
            </Form.Item>
          )
        }
        }
      </ProFormList>
      <ProFormList
        name='phoneList'
        label='联系固话'
        creatorRecord={() => {
          return String('')
        }}
        initialValue={['']}
        style={{marginBottom: 0}}
        creatorButtonProps={{
          creatorButtonText: '添加电话',
          type: 'link',
          style: {width: 'unset'},
        }}
        copyIconProps={false}
        deleteIconProps={{tooltipText: '删除'}}
        itemRender={({listDom, action}) => (
          <div
            style={{
              display: 'inline-flex',
              marginInlineEnd: 24,
            }}
          >
            {listDom}
            {action}
          </div>
        )}
      >
        {(field, idx) => {
          return (
            <Form.Item
              {...field}
              label={idx + 1}
              rules={[
                {
                  required: true,
                  message: '请输入电话',
                },
                ({getFieldValue}) => ({
                  validator(_, value) {
                    if (!value || !value.length) {
                      return Promise.resolve()
                    }
                    let list = getFieldValue('phoneList')
                    let count = list?.filter((v: string) => v === value)?.length
                    if (count > 1) {
                      return Promise.reject(new Error('请勿重复输入'))
                    }
                    return Promise.resolve()
                  }
                })
              ]}
            >
              {
                userInfo?.viewer ?
                  <span>{userInfo.phoneList?.[idx] || '-'}</span> :
                  <Input/>
              }
            </Form.Item>
          )
        }
        }
      </ProFormList>
      <ProFormText
        name='office'
        label='办公地址'
      />
      <ProFormText
        name='nation'
        label='民族'
      />
      <ProFormText
        name='politics'
        label='政治面貌'
      />
      <ProFormDatePicker
        name='birthday'
        label='生日'
      />
      <ProFormDigit
        name='orderNum'
        label='排序'
      />
      <ProFormText
        name='mainJobCode'
        label='主职位标识'
      />
      <ProFormSelect
        name='degree'
        label='学位'
        options={DegreeEnum.toOptions()}
      />
      <ProFormSelect
        name='gender'
        label='性别'
        options={GenderEnum.toOptions()}
      />
      <ProFormSelect
        name='status'
        label='状态'
        options={StatusEnum.toOptions()}
      />
      <ProFormSelect
        name='authType'
        label='授权类型'
        options={AuthTypeEnum.toOptions()}
      />
      <ProFormSelect
        name='schemaCodes'
        label='使用模式'
        fieldProps={{mode: 'multiple'}}
        options={SchemaEnum.toOptions()}
      />
      <ProFormList
        name='tags'
        label='标签'
        creatorButtonProps={{
          creatorButtonText: '添加标签',
        }}
        copyIconProps={{tooltipText: '复制'}}
        deleteIconProps={{tooltipText: '删除'}}
        itemRender={({listDom, action}) => (
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
    </ModalForm>
  )
}

export default React.forwardRef(Edit)
