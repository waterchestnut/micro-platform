import { PageContainer } from '@ant-design/pro-components';
import { useModel } from '@umijs/max';
import { Card, theme } from 'antd';
import React from 'react';

const Home: React.FC = () => {
  const { token } = theme.useToken();
  const { initialState } = useModel('@@initialState');
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
            欢迎使用知识库平台
          </div>
          <p
            style={{
              fontSize: '14px',
              color: token.colorTextSecondary,
              lineHeight: '22px',
              marginTop: 16,
              marginBottom: 32,
              width: '65%',
            }}
          >
            创建知识库、启用知识库、禁用知识库。
          </p>
        </div>
      </Card>
    </PageContainer>
  );
};

export default Home;
