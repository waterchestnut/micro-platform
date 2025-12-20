import React, {ForwardRefRenderFunction, useImperativeHandle, useRef, useState} from 'react';
import {
  ModalForm,
  ProCard, ProFormDigit,
  ProFormGroup,
  ProFormInstance,
  ProFormList, ProFormSelect,
  ProFormText, ProFormTextArea
} from "@ant-design/pro-components"
import {uuidV4, waitTime} from "@/utils/util";
import {errorMessage, successMessage} from "@/utils/msg";
import {addDepartment, updateDepartment} from "@/services/ucenter/department";
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
  const [departmentInfo, setDepartmentInfo] = useState<any>(null);
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
    if (departmentInfo) {
      ret = await updateDepartment(formData);
      tip = '修改部门';
    } else {
      ret = await addDepartment(formData);
      tip = '添加部门';
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
      setDepartmentInfo(info || null);
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
      title={(departmentInfo ? departmentInfo.viewer ? "查看" : "编辑" : "新建") + "部门"}
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
      readonly={departmentInfo?.viewer}
      submitter={departmentInfo?.viewer ? false : undefined}
    >
      <ProFormText
        name='departmentCode'
        label='部门标识'
        rules={[
          {
            required: true,
            message: '请输入部门标识',
          },
        ]}
        readonly={departmentInfo?.viewer || departmentInfo?.departmentCode}
      />
      <ProFormText
        name='departmentName'
        label='部门名称'
        rules={[
          {
            required: true,
            message: '请输入部门名称',
          },
        ]}
      />
      <ProFormText
        name='orgCode'
        label='所属机构标识'
        rules={[
          {
            required: true,
            message: '请输入机构标识',
          },
        ]}
      />
      <ProFormText
        name='parentCode'
        label='上级部门标识'
      />
      <ProFormDigit
        name='levelNum'
        label='层级'
        rules={[
          {
            required: true,
            message: '请输入层级',
          },
        ]}
      />
      <ProFormDigit
        name='orderNum'
        label='排序'
        rules={[
          {
            required: true,
            message: '请输入排序',
          },
        ]}
      />
      <ProFormText
        name='adminCode'
        label='行政编号'
      />
      <ProFormList
        name='path'
        label='节点路径'
        creatorRecord={() => {
          return String("");
        }}
        initialValue={['']}
        rules={[
          {
            required: true,
            validator: async (_, value) => {
              /*console.log(value);*/
              if (value && value.length > 0) {
                return;
              }
              throw new Error('节点路径不能为空');
            },
          },
        ]}
        style={{marginBottom: 0}}
        creatorButtonProps={{
          creatorButtonText: '添加路径节点',
          type: 'link',
          style: {width: 'unset'},
        }}
        min={1}
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
                  message: '请输入节点路径',
                },
              ]}
            >
              {
                departmentInfo?.viewer ?
                  <span>{departmentInfo.path?.[idx] || '-'}</span> :
                  <Input/>
              }
            </Form.Item>
          )
        }
        }
      </ProFormList>
      <ProFormSelect
        name='status'
        label='状态'
        options={StatusEnum.toOptions()}
      />
      <ProFormSelect
        name='isTemp'
        label='临时组织'
        initialValue={0}
        options={[{value: 0, label: '否'}, {value: 1, label: '是'}]}
      />
    </ModalForm>
  )
}

export default React.forwardRef(Edit);
