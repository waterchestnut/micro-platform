import React, {ForwardRefRenderFunction, useImperativeHandle, useRef, useState} from 'react';
import {
  ModalForm,
  ProCard,
  ProFormGroup,
  ProFormInstance,
  ProFormList, ProFormSelect,
  ProFormText, ProFormTextArea
} from "@ant-design/pro-components"
import {uuidV4, waitTime} from "@/utils/util";
import {errorMessage, successMessage} from "@/utils/msg";
import {addClient, updateClient} from "@/services/ucenter/client";
import StatusEnum from "@/enum/StatusEnum";
import AuthTypeEnum from "@/enum/AuthTypeEnum";
import SchemaEnum from "@/enum/SchemaEnum";
import OAuthGrantTypeEnum from "@/enum/OAuthGrantTypeEnum";
import OAuthScopeEnum from "@/enum/OAuthScopeEnum";
import {SafetyOutlined} from "@ant-design/icons";
import {Button, Form, Input} from "antd";
import {urlPattern, domainPattern} from "@/utils/validator";

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
  };

const inlineItemLayout = {
  labelCol: {span: 8},
  wrapperCol: {span: 16},
};

const Edit: ForwardRefRenderFunction<EditAction, EditProps> = (props, ref) => {
  const {onEditFinish} = props;
  const [isOpen, setIsOpen] = useState(false);
  const [clientInfo, setClientInfo] = useState<any>(null);
  const formRef = useRef<ProFormInstance>();

  const handleOk = async () => {
    try {
      await formRef?.current?.validateFields();
    } catch (e) {
      console.error(e);
      return;
    }
    let formData = formRef?.current?.getFieldsFormatValue?.(true);
    let ret;
    let tip;
    if (clientInfo) {
      ret = await updateClient(formData);
      tip = '修改应用';
    } else {
      ret = await addClient(formData);
      tip = '添加应用';
    }
    if (ret.code !== 0) {
      let msg = ret.msg || tip + '失败，请稍后再试';
      return errorMessage(msg);
    }

    if (onEditFinish) {
      await onEditFinish()
    }
    successMessage(tip + '成功');
    setIsOpen(false);
  };

  const handleCancel = () => {
    setIsOpen(false);
  };

  useImperativeHandle(ref, () => ({
    show: async (info: any) => {
      setClientInfo(info || null);
      waitTime(200).then(() => {
        if (info) {
          formRef?.current?.setFieldsValue(info);
        } else {
          formRef?.current?.resetFields();
        }
      });
      setIsOpen(true);
    },
    close: () => {
      handleCancel();
    }
  }));

  return (
    <ModalForm
      title={(clientInfo ? clientInfo.viewer ? "查看" : "编辑" : "新建") + "应用"}
      open={isOpen}
      layout={'horizontal'}
      modalProps={
        {
          onCancel: handleCancel,
          centered: true,
          destroyOnClose: true
        }
      }
      onFinish={async () => {
        await handleOk()
      }}
      formRef={formRef}
      {...formItemLayout}
      grid={true}
      readonly={clientInfo?.viewer}
      submitter={clientInfo?.viewer ? false : undefined}
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
      <ProFormText
        name='clientSecret'
        label='秘钥'
        rules={[
          {
            required: true,
            message: '请生成秘钥',
          },
        ]}
        disabled={true}
        fieldProps={{
          suffix: clientInfo?.viewer ? null : <Button size='small' type='link' onClick={() => {
            formRef?.current?.setFieldsValue({clientSecret: uuidV4()})
          }}>生成秘钥</Button>
        }}
      />
      <ProFormList
        name='retUrls'
        label='回调域名'
        creatorRecord={() => {
          return String("");
        }}
        initialValue={['']}
        style={{marginBottom: 0}}
        creatorButtonProps={{
          creatorButtonText: '添加回调域名',
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
              extra='不带http或https'
              rules={[
                {
                  required: true,
                  message: '请输入回调域名',
                },
                {pattern: domainPattern, message: '请输入正确的回调域名'},
                ({getFieldValue}) => ({
                  validator(_, value) {
                    if (!value || !value.length) {
                      return Promise.resolve();
                    }
                    let list = getFieldValue('retUrls');
                    let count = list?.filter((v: string) => v === value)?.length;
                    if (count > 1) {
                      return Promise.reject(new Error('请勿重复输入'));
                    }
                    return Promise.resolve();
                  }
                })
              ]}
            >
              {
                clientInfo?.viewer ?
                  <span>{clientInfo.retUrls?.[idx] || '-'}</span> :
                  <Input/>
              }
            </Form.Item>
          )
        }
        }
      </ProFormList>
      <ProFormSelect
        name='grantTypes'
        label='授权模式'
        fieldProps={{mode: 'multiple'}}
        options={OAuthGrantTypeEnum.toOptions()}
      />
      <ProFormSelect
        name='scopes'
        label='授权范围'
        fieldProps={{mode: 'multiple'}}
        options={OAuthScopeEnum.toOptions()}
      />
      <ProFormSelect
        name='status'
        label='状态'
        options={StatusEnum.toOptions()}
      />
      <ProFormTextArea
        name='description'
        label='应用描述'
      />
      <ProFormList
        name='loginUrls'
        label='统一登入地址'
        creatorRecord={() => {
          return String("");
        }}
        initialValue={['']}
        style={{marginBottom: 0}}
        creatorButtonProps={{
          creatorButtonText: '添加登入地址',
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
              extra='带http或https'
              rules={[
                {
                  required: true,
                  message: '请输入登入地址',
                },
                {pattern: urlPattern, message: '请输入正确的登入地址'},
                ({getFieldValue}) => ({
                  validator(_, value) {
                    if (!value || !value.length) {
                      return Promise.resolve();
                    }
                    let list = getFieldValue('loginUrls');
                    let count = list?.filter((v: string) => v === value)?.length;
                    if (count > 1) {
                      return Promise.reject(new Error('请勿重复输入'));
                    }
                    return Promise.resolve();
                  }
                })
              ]}
            >
              {
                clientInfo?.viewer ?
                  <span>{clientInfo.loginUrls?.[idx] || '-'}</span> :
                  <Input/>
              }
            </Form.Item>
          )
        }
        }
      </ProFormList>
      <ProFormList
        name='logoutUrls'
        label='统一登出地址'
        creatorRecord={() => {
          return String("");
        }}
        initialValue={['']}
        style={{marginBottom: 0}}
        creatorButtonProps={{
          creatorButtonText: '添加登出地址',
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
              extra='带http或https'
              rules={[
                {
                  required: true,
                  message: '请输入登出地址',
                },
                {pattern: urlPattern, message: '请输入正确的登出地址'},
                ({getFieldValue}) => ({
                  validator(_, value) {
                    if (!value || !value.length) {
                      return Promise.resolve();
                    }
                    let list = getFieldValue('logoutUrls');
                    let count = list?.filter((v: string) => v === value)?.length;
                    if (count > 1) {
                      return Promise.reject(new Error('请勿重复输入'));
                    }
                    return Promise.resolve();
                  }
                })
              ]}
            >
              {
                clientInfo?.viewer ?
                  <span>{clientInfo.logoutUrls?.[idx] || '-'}</span> :
                  <Input/>
              }
            </Form.Item>
          )
        }
        }
      </ProFormList>
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
    </ModalForm>
  )
}

export default React.forwardRef(Edit);
