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
import {addOrg, updateOrg} from "@/services/ucenter/org";
import StatusEnum from "@/enum/StatusEnum";
import AuthTypeEnum from "@/enum/AuthTypeEnum";
import SchemaEnum from "@/enum/SchemaEnum";
import OAuthGrantTypeEnum from "@/enum/OAuthGrantTypeEnum";
import OAuthScopeEnum from "@/enum/OAuthScopeEnum";
import {SafetyOutlined} from "@ant-design/icons";
import {Button, Form, Input} from "antd";
import {urlPattern, domainPattern, emailPattern, mobilePattern} from "@/utils/validator";
import OrgTypeEnum from "@/enum/OrgTypeEnum";

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
  const [orgInfo, setOrgInfo] = useState<any>(null);
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
    if (orgInfo) {
      ret = await updateOrg(formData);
      tip = '修改机构';
    } else {
      ret = await addOrg(formData);
      tip = '添加机构';
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
      setOrgInfo(info || null);
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
      title={(orgInfo ? orgInfo.viewer ? "查看" : "编辑" : "新建") + "机构"}
      open={isOpen}
      layout={'horizontal'}
      modalProps={
        {
          onCancel: handleCancel,
          centered: true,
          className: `modal-fixed ${orgInfo?.viewer ? 'modal-no-footer' : ''}`,
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
      readonly={orgInfo?.viewer}
      submitter={orgInfo?.viewer ? false : undefined}
    >
      <ProFormText
        name='orgCode'
        label='机构标识'
        rules={[
          {
            required: true,
            message: '请输入机构标识',
          },
        ]}
        readonly={orgInfo?.viewer || orgInfo?.orgCode}
      />
      <ProFormText
        name='orgName'
        label='机构名称'
        rules={[
          {
            required: true,
            message: '请输入机构名称',
          },
        ]}
      />
      <ProFormText
        name='orgNameEn'
        label='英文名称'
      />
      <ProFormText
        name='coverUrl'
        label='封面地址'
        rules={[
          {pattern: urlPattern, message: '请输入正确的封面地址'},
        ]}
      />
      <ProFormGroup>
        <ProFormText
          name='firstLetter'
          label='单个首字母'
          rules={[
            {
              required: true,
              message: '请输入首字母',
            },
          ]}
          colProps={{span: 12}}
          {...inlineItemLayout}
        />
        <ProFormText
          name='letters'
          label='首字母集合'
          rules={[
            {
              required: true,
              message: '请输入首字母集合',
            },
          ]}
          colProps={{span: 12}}
          {...inlineItemLayout}
        />
      </ProFormGroup>
      <ProFormText
        name='pinyin'
        label='全拼'
        rules={[
          {
            required: true,
            message: '请输入全拼',
          },
        ]}
      />
      <ProFormSelect
        name='authType'
        label='授权类型'
        options={AuthTypeEnum.toOptions()}
      />
      <ProFormSelect
        name='status'
        label='状态'
        options={StatusEnum.toOptions()}
      />
      <ProFormSelect
        name='orgTypes'
        label='机构类型'
        fieldProps={{mode: 'multiple'}}
        options={OrgTypeEnum.toOptions()}
      />
      <ProFormSelect
        name='schemaCodes'
        label='使用模式'
        fieldProps={{mode: 'multiple'}}
        options={SchemaEnum.toOptions()}
      />
      <ProFormTextArea
        name='des'
        label='机构介绍'
      />
      <ProFormTextArea
        name='desEn'
        label='英文介绍'
      />
      <ProFormList
        name='contactList'
        label='联系人'
        creatorButtonProps={{
          creatorButtonText: '添加联系人',
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
            name='realName'
            label='姓名'
            rules={[
              {
                required: true,
                message: '请输入姓名',
              },
            ]}
            colProps={{span: 12}}
            {...inlineItemLayout}
          />
          <ProFormText
            name='mobile'
            label='手机'
            rules={[
              {
                required: true,
                message: '请输入手机号',
              },
              {pattern: mobilePattern, message: '请输入正确的手机号'},
            ]}
            colProps={{span: 12}}
            {...inlineItemLayout}
          />
        </ProFormGroup>
        <ProFormGroup>
          <ProFormText
            name='phone'
            label='固话'
            colProps={{span: 12}}
            {...inlineItemLayout}
          />
          <ProFormText
            name='postcode'
            label='邮编'
            colProps={{span: 12}}
            {...inlineItemLayout}
          />
        </ProFormGroup>
        <ProFormText
          name='email'
          label='邮箱'
          rules={[
            {pattern: emailPattern, message: '请输入正确的邮箱'},
          ]}
          {...formItemLayout}
        />
      </ProFormList>
    </ModalForm>
  )
}

export default React.forwardRef(Edit);
