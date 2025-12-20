import React, {ForwardRefRenderFunction, useEffect, useImperativeHandle, useRef, useState} from 'react';
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
import {addModule, updateModule} from "@/services/ucenter/module";
import StatusEnum from "@/enum/StatusEnum";
import AuthTypeEnum from "@/enum/AuthTypeEnum";
import SchemaEnum from "@/enum/SchemaEnum";
import {getClientList} from "@/services/ucenter/client";

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
  const [moduleInfo, setModuleInfo] = useState<any>(null);
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
    if (moduleInfo) {
      ret = await updateModule(formData);
      tip = '修改模块';
    } else {
      ret = await addModule(formData);
      tip = '添加模块';
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
      setModuleInfo(info || null);
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
      title={(moduleInfo ? moduleInfo.viewer ? "查看" : "编辑" : "新建") + "模块"}
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
      readonly={moduleInfo?.viewer}
      submitter={moduleInfo?.viewer ? false : undefined}
    >
      <ProFormText
        name='moduleCode'
        label='模块标识'
        rules={[
          {
            required: true,
            message: '请输入模块标识',
          },
        ]}
        readonly={moduleInfo?.viewer || moduleInfo?.moduleCode}
      />
      <ProFormText
        name='moduleName'
        label='模块名称'
        rules={[
          {
            required: true,
            message: '请输入模块名称',
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
    </ModalForm>
  )
}

export default React.forwardRef(Edit);
