import { PageContainer,
  ProFormText, } from '@ant-design/pro-components';
import { useModel } from '@umijs/max';
import { Card, theme } from 'antd';
import { Button, Form, Input, Select } from 'antd';
import {queryPhoneRegion} from "@/services/ucenter/phone";
import React from 'react';
import {useState} from 'react';

const PhoneQuery: React.FC = () => {
  const { token } = theme.useToken();
  const { initialState } = useModel('@@initialState');
  const [provName, setProvName] = useState('')
  const [cityName, setCityName] = useState('')

  
  const onFinish = async (values: any) => {
    let data = await queryPhoneRegion(values.phonenumber);
    console.log(data)
    setProvName(data.provName)
    setCityName(data.cityName)
  };

  const checkPhoneNumber = (_: any, value: string) => {
    let regex = /\d{11}/
    if(regex.test(value)){
      return Promise.resolve();
    }
    return Promise.reject(new Error('请输入正确的手机号'));
  };
  return (
    <PageContainer>
      <Card
        style={{
          borderRadius: 8,
        }}
      >
        <div
        >
          <div
            style={{
              fontSize: '20px',
              color: token.colorTextHeading,
            }}
          >
            手机号归属地查询
          </div>
          <Form
            name="customized_form_controls"
            layout="inline"
            onFinish={onFinish}
          >
            <ProFormText
                width="md"
                name="phonenumber"
                label="手机号"
                placeholder="请输入手机号"
                rules={[{ validator: checkPhoneNumber }]}
              />
            <Form.Item>
              <Button type="primary" htmlType="submit">
                Submit
              </Button>
            </Form.Item>
          </Form>
        </div>
        <div>所属省份 : {provName}</div>
        <div>所属城市 : {cityName}</div>
      </Card>
    </PageContainer>
  );
};

export default PhoneQuery;
