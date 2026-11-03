import {PageContainer} from '@ant-design/pro-components';
import {history, useModel} from '@umijs/max';
import {Button, Card, Col, Row, Space, Typography} from 'antd';
import {
  ApartmentOutlined,
  AppstoreOutlined,
  BankOutlined,
  FileProtectOutlined,
  GlobalOutlined,
  IdcardOutlined,
  KeyOutlined,
  PhoneOutlined,
  RightOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import React from 'react';
import {theme} from 'antd';
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
  authority?: string[];
}

const ENTRIES: EntryItem[] = [
  {title: '用户管理', desc: '平台用户的创建、维护与角色分配', path: '/user/list', icon: <UserOutlined/>, color: '#1677ff', authority: ['ucenter-ipmi-user-browse']},
  {title: '角色管理', desc: '角色的定义、授权与成员关联', path: '/group/list', icon: <TeamOutlined/>, color: '#722ed1', authority: ['ucenter-ipmi-group-browse']},
  {title: '接入应用', desc: '接入平台的子系统与凭证管理', path: '/client/list', icon: <AppstoreOutlined/>, color: '#fa8c16', authority: ['ucenter-ipmi-client-browse']},
  {title: '权限管理', desc: '模块、权限点与页面的配置维护', path: '/auth/module', icon: <KeyOutlined/>, color: '#13c2c2', authority: ['ucenter-ipmi-auth-browse']},
  {title: '机构管理', desc: '组织机构树的建立与维护', path: '/org/list', icon: <BankOutlined/>, color: '#eb2f96', authority: ['ucenter-ipmi-org-browse']},
  {title: '部门管理', desc: '部门架构与上下级关系维护', path: '/department/list', icon: <ApartmentOutlined/>, color: '#52c41a', authority: ['ucenter-ipmi-department-browse']},
  {title: '职位管理', desc: '职位序列与岗位信息维护', path: '/job/list', icon: <IdcardOutlined/>, color: '#faad14', authority: ['ucenter-ipmi-job-browse']},
  {title: '区域管理', desc: '行政区域数据的维护与引用', path: '/region/list', icon: <GlobalOutlined/>, color: '#2f54eb', authority: ['ucenter-ipmi-region-browse']},
  {title: '协议管理', desc: '平台协议版本与签署情况', path: '/agreement/list', icon: <FileProtectOutlined/>, color: '#f5222d', authority: ['ucenter-ipmi-agreement-browse']},
  {title: '号码查询', desc: '手机号归属与号段信息查询', path: '/phonenumber', icon: <PhoneOutlined/>, color: '#8c8c8c'},
];

const Home: React.FC = () => {
  const {token} = theme.useToken();
  const {initialState} = useModel('@@initialState');
  const currentUser = initialState?.currentUser;
  const userName = currentUser?.realName || currentUser?.nickName || currentUser?.userCode || '';

  const privs = currentUser?.privs as string[] | undefined;
  const entries = ENTRIES.filter((entry) => !entry.authority || checkPermissions(entry.authority, privs));
  const canManageUser = checkPermissions(['ucenter-ipmi-user-browse'], privs);

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
              {formatDate()} · 用户与授权管理平台，覆盖用户、角色、机构、部门、职位、区域与权限的全链路管理
            </div>
          </Col>
          <Col flex="none">
            <Space>
              {canManageUser && (
                <Button type="primary" icon={<UserOutlined/>} onClick={() => history.push('/user/list')}>
                  用户管理
                </Button>
              )}
              <Button icon={<PhoneOutlined/>} onClick={() => history.push('/phonenumber')}>
                号码查询
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* 功能入口 */}
      <Row gutter={[16, 16]}>
        {entries.map((entry) => (
          <Col key={entry.path} xs={24} sm={12} lg={8} xl={6}>
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
                  <Paragraph
                    type="secondary"
                    style={{fontSize: 13, marginBottom: 0}}
                    ellipsis={{rows: 2}}
                  >
                    {entry.desc}
                  </Paragraph>
                </div>
              </div>
            </Card>
          </Col>
        ))}
      </Row>
    </PageContainer>
  );
};

export default Home;
