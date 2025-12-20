import {PageContainer} from '@ant-design/pro-components';
import {useModel} from '@umijs/max';
import {Card, theme} from 'antd';
import React from 'react';

const Home: React.FC = () => {
  const {token} = theme.useToken();
  const {initialState} = useModel('@@initialState');
  return (
    <PageContainer
      token={{
        paddingBlockPageContainerContent: 24,
        paddingInlinePageContainerContent: 40
      }}
    >
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
            欢迎使用微平台
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
            用户与授权、应用管理、日志管理。
          </p>
        </div>
      </Card>
    </PageContainer>
  );
};

export default Home;
