import {PageContainer} from '@ant-design/pro-components';
import {history, useModel} from '@umijs/max';
import {Avatar, Button, Card, Col, Empty, Row, Space, Tag, theme, Tooltip} from 'antd';
import {AppstoreOutlined, GlobalOutlined, RightOutlined, RobotOutlined} from '@ant-design/icons';
import React, {useMemo} from 'react';
import {checkPermissions} from '@/utils/authority';
import {getDocHttpUrl} from '@/utils/util';
// @ts-ignore
import type {APPAPI} from '@/services/app/typings';

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

const getDefaultLogoUrl = (clientInfo: APPAPI.ClientPublic) => {
  const visitPath = clientInfo.endpoints?.find((_: APPAPI.ClientPublic) => _.endpointType === 'pc')?.visitPath;
  try {
    return `${new URL(visitPath).origin}/logo.svg`;
  } catch (e) {
    return undefined;
  }
};

const Home: React.FC = () => {
  const {token} = theme.useToken();
  const {initialState} = useModel('@@initialState');
  const {setAppsPopOpened} = useModel('appsPop');
  const currentUser = initialState?.currentUser;

  const userName = currentUser?.realName || currentUser?.nickName || currentUser?.userCode || '';

  /** 与 AppsPop 一致的可见性过滤（needAuth2Show 时按 clientCode-browse 权限） */
  const visibleClients = useMemo(() => {
    const clients = (initialState?.toShowClients || []) as APPAPI.ClientPublic[];
    return clients.filter((clientInfo) => {
      const authority = clientInfo.needAuth2Show ? [`${clientInfo.clientCode}-browse`] : false;
      return checkPermissions(authority, currentUser?.privs);
    });
  }, [initialState?.toShowClients, currentUser?.privs]);

  /** 与 AppsPop 一致的跳转：站内路径直跳，外部应用走 wujie /sub/:clientCode */
  const openClient = (clientInfo: APPAPI.ClientPublic) => {
    const visitPath = clientInfo.endpoints?.find((_: APPAPI.ClientPublic) => _.endpointType === 'pc')?.visitPath;
    history.push(visitPath?.startsWith('/') ? visitPath : `/sub/${clientInfo.clientCode}`);
  };

  return (
    <PageContainer
      token={{
        paddingBlockPageContainerContent: 24,
        paddingInlinePageContainerContent: 40
      }}
    >
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
              {formatDate()} · 欢迎回到微平台，下面列出了你可以访问的全部应用
            </div>
          </Col>
          <Col flex="none">
            <Space>
              <Button type="primary" icon={<RobotOutlined/>} onClick={() => history.push('/chat')}>
                AI 助手
              </Button>
              <Button icon={<AppstoreOutlined/>} onClick={() => setAppsPopOpened(true)}>
                应用中心
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* 应用网格 */}
      <Card
        title={<Space><GlobalOutlined/>我的应用</Space>}
        extra={
          <Button type="link" onClick={() => setAppsPopOpened(true)}>
            浏览全部 <RightOutlined/>
          </Button>
        }
        style={{borderRadius: 12}}
        styles={{body: {paddingTop: 8}}}
      >
        {visibleClients.length > 0 ? (
          <Row gutter={[16, 16]}>
            {visibleClients.map((client) => (
              <Col key={client.clientCode} xs={24} sm={12} lg={8} xl={6}>
                <Card
                  hoverable
                  size="small"
                  onClick={() => openClient(client)}
                  styles={{body: {padding: 16}}}
                >
                  <div style={{display: 'flex', gap: 12, alignItems: 'flex-start'}}>
                    <Avatar
                      src={client.logoUrl ? getDocHttpUrl(client.logoUrl) : getDefaultLogoUrl(client)}
                      shape="square"
                      size={44}
                      style={{flexShrink: 0, borderRadius: 10}}
                    />
                    <div style={{flex: 1, minWidth: 0}}>
                      <div style={{fontWeight: 500, fontSize: 15, marginBottom: 4}}>{client.clientName}</div>
                      <Tooltip title={client.description}>
                        <div
                          style={{
                            color: token.colorTextSecondary,
                            fontSize: 13,
                            lineHeight: '20px',
                            height: 40,
                            overflow: 'hidden',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                          }}
                        >
                          {client.description}
                        </div>
                      </Tooltip>
                    </div>
                  </div>
                  {(client.tags || []).length > 0 && (
                    <div style={{marginTop: 10}}>
                      {(client.tags || []).slice(0, 3).map((tag: APPAPI.Tag) =>
                        tag.value ? <Tag key={tag.key || tag.value} bordered={false}>{tag.value}</Tag> : null,
                      )}
                    </div>
                  )}
                </Card>
              </Col>
            ))}
          </Row>
        ) : (
          <Empty
            style={{padding: '60px 0'}}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={<span style={{color: token.colorTextDescription}}>暂无可访问的应用</span>}
          >
            <Button type="primary" size="small" onClick={() => setAppsPopOpened(true)}>
              打开应用中心
            </Button>
          </Empty>
        )}
      </Card>
    </PageContainer>
  );
};

export default Home;
