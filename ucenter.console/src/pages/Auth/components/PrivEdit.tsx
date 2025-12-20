import React, {ForwardRefRenderFunction, useImperativeHandle, useRef, useState} from 'react';
import {
  ModalForm,
  ProCard,
  ProFormDependency, ProFormDigit,
  ProFormFieldSet, ProFormGroup,
  ProFormInstance,
  ProFormList, ProFormSelect,
  ProFormText, ProFormTextArea
} from "@ant-design/pro-components"
import {waitTime} from "@/utils/util";
import {errorMessage, successMessage} from "@/utils/msg";
import {addPriv, updatePriv} from "@/services/ucenter/priv";
import StatusEnum from "@/enum/StatusEnum";
import AuthTypeEnum from "@/enum/AuthTypeEnum";
import SchemaEnum from "@/enum/SchemaEnum";
import {getClientList} from "@/services/ucenter/client";
import PrivVerbEnum from "@/enum/PrivVerbEnum";
import {getModuleList} from "@/services/ucenter/module";

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
  const [privInfo, setPrivInfo] = useState<any>(null);
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
    if (privInfo) {
      ret = await updatePriv(formData);
      tip = '修改权限';
    } else {
      ret = await addPriv(formData);
      tip = '添加权限';
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
      setPrivInfo(info || null);
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
      title={(privInfo ? privInfo.viewer ? "查看" : "编辑" : "新建") + "权限"}
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
      readonly={privInfo?.viewer}
      submitter={privInfo?.viewer ? false : undefined}
      onValuesChange={(changedValues, values) => {
        if ((changedValues.moduleCode || changedValues.privVerb) && values.moduleCode && values.privVerb) {
          formRef?.current?.setFieldsValue?.({modulePrivCode: `${values.moduleCode}-${values.privVerb}`});
        }
      }}
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
      <ProFormSelect
        name='moduleCode'
        label='所属模块'
        dependencies={['clientCode']}
        request={async (params) => {
          /*console.log(params);*/
          if (!params.clientCode) {
            return [];
          }
          let data = await getModuleList(1, 10, {moduleName: params.keyWords, clientCode: params.clientCode});
          return (data.rows || []).map((module: any) => ({label: module.moduleName, value: module.moduleCode}));
        }}
        fieldProps={{
          showSearch: true
        }}
        debounceTime={600}
        rules={[
          {
            required: true,
            message: '请选择模块',
          },
        ]}
      />
      <ProFormSelect
        name='privVerb'
        label='权限动作'
        options={PrivVerbEnum.toOptions()}
        rules={[
          {
            required: true,
            message: '请选择权限动作',
          },
        ]}
        initialValue='browse'
      />
      <ProFormText
        name='modulePrivCode'
        label='权限标识'
        rules={[
          {
            required: true,
            message: '请输入权限标识',
          },
        ]}
      />
      <ProFormText
        name='modulePrivName'
        label='权限名称'
        rules={[
          {
            required: true,
            message: '请输入权限名称',
          },
        ]}
      />
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
      <ProFormSelect
        name='authType'
        label='授权类型'
        options={AuthTypeEnum.toOptions()}
        rules={[
          {
            required: true,
            message: '请选择授权类型',
          },
        ]}
        initialValue={0}
      />
    </ModalForm>
  )
}

export default React.forwardRef(Edit);
