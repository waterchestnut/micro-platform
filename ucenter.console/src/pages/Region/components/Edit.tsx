import React, {ForwardRefRenderFunction, useImperativeHandle, useRef, useState} from 'react';
import {
  ModalForm,
  ProFormDependency, ProFormDigit,
  ProFormFieldSet,
  ProFormInstance,
  ProFormList,
  ProFormText
} from "@ant-design/pro-components"
import {waitTime} from "@/utils/util";
import {errorMessage, successMessage} from "@/utils/msg";
import {addRegion, updateRegion} from "@/services/ucenter/region";
import {Form, Input} from 'antd';

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
  const [regionInfo, setRegionInfo] = useState<any>(null);
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
    if (regionInfo) {
      ret = await updateRegion(formData);
      tip = '修改地区';
    } else {
      ret = await addRegion(formData);
      tip = '添加地区';
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
      setRegionInfo(info || null);
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
      title={(regionInfo ? regionInfo.viewer ? "查看" : "编辑" : "新建") + "地区"}
      open={isOpen}
      layout={'horizontal'}
      modalProps={
        {
          onCancel: handleCancel,
          centered: true,
          className: `modal-fixed ${regionInfo?.viewer ? 'modal-no-footer' : ''}`,
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
      readonly={regionInfo?.viewer}
      submitter={regionInfo?.viewer ? false : undefined}
    >
      <ProFormText
        name='regionCode'
        label='地区标识'
        rules={[
          {
            required: true,
            message: '请输入地区标识',
          },
        ]}
        readonly={regionInfo?.viewer || regionInfo?.regionCode}
      />
      <ProFormText
        name='regionName'
        label='地区名称'
        rules={[
          {
            required: true,
            message: '请输入地区名称',
          },
        ]}
      />
      <ProFormText
        name='fullName'
        label='全名'
        rules={[
          {
            required: true,
            message: '请输入全名',
          },
        ]}
      />
      <ProFormText
        name='parentCode'
        label='父节点'
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
        style={{marginBottom:0}}
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
                regionInfo?.viewer ?
                  <span>{regionInfo.path?.[idx] || '-'}</span> :
                  <Input/>
              }
            </Form.Item>
          )
        }
        }
      </ProFormList>
      <ProFormText
        name='typeName'
        label='类型'
      />
      <ProFormText
        name='nameEn'
        label='英文名'
      />
      <ProFormText
        name='shortName'
        label='简称'
      />
      <ProFormText
        name='shortNameEn'
        label='英文简称'
      />
      <ProFormText
        name='firstLetter'
        label='首字母'
      />
      <ProFormText
        name='letters'
        label='全拼首字母'
      />
      <ProFormText
        name='pinyin'
        label='全拼'
      />
      <ProFormText
        name='extra'
        label='附加信息'
      />
    </ModalForm>
  )
}

export default React.forwardRef(Edit);
