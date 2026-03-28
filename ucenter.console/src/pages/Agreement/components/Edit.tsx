import React, {ForwardRefRenderFunction, useImperativeHandle, useRef, useState} from 'react';
import {
  ModalForm,
  ProFormDatePicker,
  ProFormDigit,
  ProFormInstance,
  ProFormSelect,
  ProFormText,
  ProFormTextArea
} from "@ant-design/pro-components"
import {waitTime} from "@/utils/util";
import {errorMessage, successMessage} from "@/utils/msg";
import {addAgreement, updateAgreement} from "@/services/ucenter/agreement";
import StatusEnum from "@/enum/StatusEnum";
import AgreementTypeEnum from "@/enum/AgreementTypeEnum";

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

const Edit: ForwardRefRenderFunction<EditAction, EditProps> = (props, ref) => {
  const {onEditFinish} = props;
  const [isOpen, setIsOpen] = useState(false);
  const [agreementInfo, setAgreementInfo] = useState<any>(null);
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
    if (agreementInfo) {
      ret = await updateAgreement(formData);
      tip = '修改协议';
    } else {
      ret = await addAgreement(formData);
      tip = '添加协议';
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
      setAgreementInfo(info || null);
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
      title={(agreementInfo ? agreementInfo.viewer ? "查看" : "编辑" : "新建") + "协议"}
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
      readonly={agreementInfo?.viewer}
      submitter={agreementInfo?.viewer ? false : undefined}
    >
      <ProFormText
        name='agreementCode'
        label='协议标识'
        readonly={agreementInfo?.viewer || agreementInfo?.agreementCode}
      />
      <ProFormText
        name='title'
        label='协议标题'
        rules={[
          {
            required: true,
            message: '请输入协议标题',
          },
        ]}
      />
      <ProFormSelect
        name='type'
        label='协议类型'
        options={AgreementTypeEnum.toOptions()}
        rules={[
          {
            required: true,
            message: '请选择协议类型',
          },
        ]}
      />
      <ProFormDigit
        name='version'
        label='版本号'
        rules={[
          {
            required: true,
            message: '请输入版本号',
          },
        ]}
        fieldProps={{precision: 0}}
      />
      <ProFormDatePicker
        name='effectiveTime'
        label='生效时间'
      />
      <ProFormTextArea
        name='content'
        label='协议内容'
        fieldProps={{
          rows: 10,
        }}
      />
      <ProFormSelect
        name='status'
        label='状态'
        options={StatusEnum.toOptions()}
      />
    </ModalForm>
  )
}

export default React.forwardRef(Edit);
