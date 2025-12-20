import React, {ForwardRefRenderFunction, useImperativeHandle, useRef, useState} from 'react';
import {
  ModalForm,
  ProCard,
  ProFormDependency, ProFormDigit,
  ProFormFieldSet, ProFormGroup,
  ProFormInstance,
  ProFormList, ProFormSelect, ProFormSwitch,
  ProFormText, ProFormTextArea
} from "@ant-design/pro-components"
import {uuidV4, waitTime} from "@/utils/util";
import {errorMessage, successMessage} from "@/utils/msg";
import {savePage} from "@/services/ucenter/page";
import StatusEnum from "@/enum/StatusEnum";
import AuthTypeEnum from "@/enum/AuthTypeEnum";
import SchemaEnum from "@/enum/SchemaEnum";
import {Button} from "antd";
import {getClientList} from "@/services/ucenter/client";
import RequestMethodEnum from "@/enum/RequestMethodEnum";
import {getPrivList} from "@/services/ucenter/priv";

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
  const [pageInfo, setPageInfo] = useState<any>(null);
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
    let tip = '保存路由配置';
    ret = await savePage(formData);
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
      setPageInfo(info || null);
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
      title={(pageInfo ? pageInfo.viewer ? "查看" : "编辑" : "新建") + "路由配置"}
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
      readonly={pageInfo?.viewer}
      submitter={pageInfo?.viewer ? false : undefined}
    >
      <ProFormSelect
        name='clientCode'
        label='所属应用'
        request={async (params) => {
          /*console.log(params);*/
          let data = await getClientList(1, 60, {clientName: params.keyWords});
          return (data.rows || []).map((client: any) => ({label: client.clientName, value: client.clientCode}));
        }}
        fieldProps={{
          showSearch: true
        }}
        debounceTime={600}
        rules={[
          {
            required: true,
            message: '请选择应用',
          },
        ]}
      />
      <ProFormText
        name='pageConfigCode'
        label='路由配置标识'
        rules={[
          {
            required: true,
            message: '请输入路由配置标识',
          },
        ]}
        fieldProps={{
          suffix: pageInfo?.viewer ? null : <Button size='small' type='link' onClick={() => {
            formRef?.current?.setFieldsValue({pageConfigCode: uuidV4()})
          }}>生成标识</Button>
        }}
      />
      <ProFormText
        name='name'
        label='路由配置名称'
        rules={[
          {
            required: true,
            message: '请输入路由配置名称',
          },
        ]}
      />
      <ProFormText
        name='path'
        label='请求路径'
        rules={[
          {
            required: true,
            message: '请输入路径',
          },
        ]}
        extra='应用内的路径，例：/core/client/ipmi/list'
      />
      <ProFormSelect
        name='method'
        label='请求方法'
        options={RequestMethodEnum.toOptions()}
        rules={[
          {
            required: true,
            message: '请选择请求方法',
          },
        ]}
        fieldProps={{
          mode: 'multiple'
        }}
        initialValue={[RequestMethodEnum.GET, RequestMethodEnum.POST]}
      />
      <ProFormDigit
        name='orderNum'
        label='排序'
        extra='应用内序号'
        initialValue={0}
      />
      <ProFormSwitch
        name='auth'
        label='用户授权'
        initialValue={true}
      />
      <ProFormDependency name={['auth']}>
        {
          ({auth}) => {
            if (!auth) {
              return null
            }

            return (
              <ProFormSelect
                name='privs'
                label='所需用户权限'
                dependencies={['clientCode']}
                request={async (params) => {
                  /*console.log(params);*/
                  if (!params.clientCode) {
                    return [];
                  }
                  let data = await getPrivList(1, 10, {modulePrivName: params.keyWords, clientCode: params.clientCode});
                  let ret = (data.rows || []).map((modulePriv: any) => ({
                    label: modulePriv.modulePrivName,
                    value: modulePriv.modulePrivCode
                  }));
                  ret.unshift({value: 'all', label: '全部（登录即可访问）'});
                  return ret;
                }}
                fieldProps={{
                  showSearch: true
                }}
                debounceTime={600}
                rules={[
                  {
                    required: true,
                    message: '请选择权限',
                  },
                ]}
              />
            )
          }
        }
      </ProFormDependency>
      <ProFormSwitch
        name='clientAuth'
        label='应用授权'
        initialValue={false}
      />
      <ProFormDependency name={['clientAuth']}>
        {
          ({clientAuth}) => {
            if (!clientAuth) {
              return null
            }

            return (
              <ProFormSelect
                name='clientPrivs'
                label='所需应用权限'
                dependencies={['clientCode']}
                request={async (params) => {
                  /*console.log(params);*/
                  if (!params.clientCode) {
                    return [];
                  }
                  let data = await getPrivList(1, 10, {modulePrivName: params.keyWords, clientCode: params.clientCode});
                  let ret = (data.rows || []).map((modulePriv: any) => ({
                    label: modulePriv.modulePrivName,
                    value: modulePriv.modulePrivCode
                  }));
                  ret.unshift({value: 'all', label: '全部（应用状态正常即可访问）'});
                  return ret;
                }}
                fieldProps={{
                  showSearch: true
                }}
                debounceTime={600}
                rules={[
                  {
                    required: true,
                    message: '请选择权限',
                  },
                ]}
              />
            )
          }
        }
      </ProFormDependency>
      <ProFormSelect
        name='status'
        label='状态'
        options={StatusEnum.toOptions()}
        rules={[
          {
            required: true,
            message: '请选择状态',
          },
        ]}
        initialValue={0}
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
    </ModalForm>
  )
}

export default React.forwardRef(Edit);
