import {PageContainer} from '@ant-design/pro-components';
import {history, useModel} from '@umijs/max';
import {Button, Card, Col, Row, Space, Typography, theme} from 'antd';
import {
  DatabaseOutlined,
  FolderOpenOutlined,
  ReadOutlined,
  RightOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import React from 'react';
import {checkPermissions} from '@/utils/authority';

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

interface EntryItem {
  title: string;
  desc: string;
  path: string;
  icon: React.ReactNode;
  color: string;
  authority: string[];
}

const ENTRIES: EntryItem[] = [
  {
    title: '知识库广场',
    desc: '浏览平台公开的知识库，查看详情并申请加入协作',
    path: '/rag/list',
    icon: <DatabaseOutlined/>,
    color: '#1677ff',
    authority: ['rag-ipmirag-browse'],
  },
  {
    title: '我的知识库',
    desc: '创建、启用、禁用知识库，管理资料、切片与分词',
    path: '/my-rag/list',
    icon: <FolderOpenOutlined/>,
    color: '#722ed1',
    authority: ['rag-myrag'],
  },
  {
    title: '已加入的知识库',
    desc: '我参与协作的知识库与资料维护入口',
    path: '/my-rag-joined/list',
    icon: <TeamOutlined/>,
    color: '#13c2c2',
    authority: ['rag-myrag'],
  },
];

const Home: React.FC = () => {
  const {token} = theme.useToken();
  const {initialState} = useModel('@@initialState');
  const currentUser = initialState?.currentUser;
  const userName = currentUser?.realName || currentUser?.nickName || currentUser?.userCode || '';

  const privs = currentUser?.privs as string[] | undefined;
  const entries = ENTRIES.filter((entry) => checkPermissions(entry.authority, privs));
  const canMyRag = checkPermissions(['rag-myrag'], privs);

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
              {formatDate()} · 知识库平台：建库 → 上传资料 → 切片处理 → 检索问答，一条链路管理你的知识资产
            </div>
          </Col>
          <Col flex="none">
            <Space>
              {canMyRag && (
                <Button type="primary" icon={<FolderOpenOutlined/>} onClick={() => history.push('/my-rag/list')}>
                  管理我的知识库
                </Button>
              )}
            </Space>
          </Col>
        </Row>
      </Card>

      {/* 功能入口 */}
      <Row gutter={[16, 16]}>
        {entries.map((entry) => (
          <Col key={entry.path} xs={24} sm={12} lg={8}>
            <Card
              hoverable
              onClick={() => history.push(entry.path)}
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
                    color: entry.color,
                    background: `${entry.color}1a`,
                  }}
                >
                  {entry.icon}
                </div>
                <div style={{flex: 1, minWidth: 0}}>
                  <div style={{fontWeight: 500, fontSize: 15, marginBottom: 4}}>
                    {entry.title} <RightOutlined style={{fontSize: 11, color: token.colorTextQuaternary}}/>
                  </div>
                  <Paragraph type="secondary" style={{fontSize: 13, marginBottom: 0}} ellipsis={{rows: 2}}>
                    {entry.desc}
                  </Paragraph>
                </div>
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      {/* 使用流程提示 */}
      <Card style={{borderRadius: 12, marginTop: 16}} styles={{body: {padding: 20}}}>
        <Space size={8} wrap>
          <ReadOutlined style={{color: token.colorPrimary}}/>
          <span style={{fontWeight: 500}}>使用流程</span>
          <span style={{color: token.colorTextSecondary}}>
            创建知识库 → 上传资料 → 等待切片/分词完成 → 启用知识库 → 在业务侧检索问答；知识库支持启用/禁用切换与成员协作。
          </span>
        </Space>
      </Card>
    </PageContainer>
  );
};

export default Home;
