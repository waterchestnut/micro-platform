import {PageContainer} from '@ant-design/pro-components';
import {history, useModel} from '@umijs/max';
import {Button, Card, Col, Row, Space, Typography, theme} from 'antd';
import {AuditOutlined, BarsOutlined, InfoCircleOutlined, RightOutlined} from '@ant-design/icons';
import React from 'react';

const {Paragraph} = Typography;

/** 按小时段的问候语 */
const getGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 12) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
};

/** 中文长日期，不引入 dayjs 依赖 */
const formatDate = () => {
  const d = new Date();
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${'日一二三四五六'[d.getDay()]}`;
};

const Home: React.FC = () => {
  const {token} = theme.useToken();
  const {initialState} = useModel('@@initialState');
  const currentUser = initialState?.currentUser;
  const userName = currentUser?.realName || currentUser?.nickName || currentUser?.userCode || '';

  return (
    <PageContainer>
      {/* 欢迎横幅 */}
      <Card
        style={{
          borderRadius: 12,
          marginBottom: 16,
          background: `linear-gradient(135deg, ${token.colorPrimaryBg} 0%, ${token.colorBgContainer} 55%, ${token.colorFillQuaternary} 100%)`,
        }}
        styles={{body: {padding: '24px 28px'}}}
      >
        <Row align="middle" justify="space-between" gutter={[16, 16]}>
          <Col flex="auto">
            <div style={{fontSize: 22, fontWeight: 600, marginBottom: 6}}>
              {getGreeting()}，{userName}
            </div>
            <div style={{color: token.colorTextSecondary}}>
              {formatDate()} · 日志平台：集中检索各子系统上报的操作与运行日志
            </div>
          </Col>
          <Col flex="none">
            <Button type="primary" icon={<BarsOutlined/>} onClick={() => history.push('/msg')}>
              日志检索
            </Button>
          </Col>
        </Row>
      </Card>

      <Row gutter={[16, 16]}>
        {/* 功能入口 */}
        <Col xs={24} lg={12}>
          <Card
            hoverable
            onClick={() => history.push('/msg')}
            style={{borderRadius: 12, height: '100%'}}
            styles={{body: {padding: 20}}}
          >
            <div style={{display: 'flex', gap: 14, alignItems: 'flex-start'}}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 20,
                  color: '#1677ff',
                  background: '#1677ff1a',
                }}
              >
                <AuditOutlined/>
              </div>
              <div style={{flex: 1, minWidth: 0}}>
                <div style={{fontWeight: 500, fontSize: 15, marginBottom: 4}}>
                  日志明细查询 <RightOutlined style={{fontSize: 11, color: token.colorTextQuaternary}}/>
                </div>
                <Paragraph type="secondary" style={{fontSize: 13, marginBottom: 0}} ellipsis={{rows: 2}}>
                  按操作类型、用户、系统等条件筛选平台日志，查看单条日志详情
                </Paragraph>
              </div>
            </div>
          </Card>
        </Col>

        {/* 数据说明 */}
        <Col xs={24} lg={12}>
          <Card style={{borderRadius: 12, height: '100%'}} styles={{body: {padding: 20}}}>
            <Space size={8} align="start">
              <InfoCircleOutlined style={{color: token.colorPrimary, marginTop: 4}}/>
              <div>
                <div style={{fontWeight: 500, marginBottom: 6}}>日志从哪里来</div>
                <Paragraph type="secondary" style={{fontSize: 13, marginBottom: 0}}>
                  各子系统通过统一日志通道上报操作与运行事件，平台解析入库后在此集中检索；排查问题时可按
                  系统 → 操作类型 → 时间范围逐层缩小，再打开详情查看完整上下文。
                </Paragraph>
              </div>
            </Space>
          </Card>
        </Col>
      </Row>
    </PageContainer>
  );
};

export default Home;
