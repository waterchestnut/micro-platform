import { PageContainer, ProFormText } from '@ant-design/pro-components';
import { Card, theme, Button, Form, Space, Spin, Alert, Descriptions } from 'antd';
import { PhoneOutlined } from '@ant-design/icons';
import { queryPhoneRegion } from '@/services/ucenter/phone';
import React, { useState } from 'react';

const PhoneQuery: React.FC = () => {
  const { token } = theme.useToken();
  const [form] = Form.useForm();
  const [provName, setProvName] = useState('');
  const [cityName, setCityName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [queried, setQueried] = useState(false)

  const onFinish = async (values: any) => {
    setLoading(true);
    setError('');
    setQueried(false);
    try {
      const data = await queryPhoneRegion(values.phonenumber);
      setProvName(data.provName || '未知');
      setCityName(data.cityName || '未知');
      setQueried(true);
    } catch (err: any) {
      setError(err.message || '查询失败,请稍后重试');
      setProvName('');
      setCityName('');
    } finally {
      setLoading(false);
    }
  };

  const checkPhoneNumber = (_: any, value: string) => {
    if (!value) {
      return Promise.reject(new Error('请输入手机号'));
    }
    const regex = /^1[3-9]\d{9}$/;
    if (regex.test(value)) {
      return Promise.resolve();
    }
    return Promise.reject(new Error('请输入正确的11位手机号'));
  };
  const handleReset = () => {
    form.resetFields();
    setProvName('');
    setCityName('');
    setError('');
    setQueried(false);
  };

  return (
    <PageContainer>
      <Card
        style={{
          borderRadius: 8,
        }}
      >
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div
            style={{
              fontSize: '20px',
              color: token.colorTextHeading,
              fontWeight: 500,
            }}
          >
            <PhoneOutlined style={{ marginRight: 8 }} />
            手机号归属地查询
          </div>

          <Form
            form={form}
            name="phone_query_form"
            layout="inline"
            onFinish={onFinish}
          >
            <ProFormText
              width="md"
              name="phonenumber"
              label="手机号"
              placeholder="请输入11位手机号"
              rules={[{ validator: checkPhoneNumber }]}
              disabled={loading}
            />
            <Form.Item>
              <Space>
                <Button type="primary" htmlType="submit" loading={loading}>
                  查询
                </Button>
                <Button onClick={handleReset} disabled={loading}>
                  重置
                </Button>
              </Space>
            </Form.Item>
          </Form>

          {loading && (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <Spin tip="查询中..." />
            </div>
          )}

          {error && (
            <Alert
              message="查询失败"
              description={error}
              type="error"
              showIcon
              closable
              onClose={() => setError('')}
            />
          )}

          {queried && !loading && !error && (
            <Card
              title="查询结果"
              type="inner"
            >
              <Descriptions column={1} bordered>
                <Descriptions.Item label="所属省份">
                  <span style={{ fontSize: '16px', fontWeight: 500 }}>
                    {provName}
                  </span>
                </Descriptions.Item>
                <Descriptions.Item label="所属城市">
                  <span style={{ fontSize: '16px', fontWeight: 500 }}>
                    {cityName}
                  </span>
                </Descriptions.Item>
              </Descriptions>
            </Card>
          )}
        </Space>
      </Card>
    </PageContainer>
  );
};

export default PhoneQuery;
