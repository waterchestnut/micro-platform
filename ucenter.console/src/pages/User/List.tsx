import React, { useRef, useState } from 'react';
import { ActionType, PageContainer, ProColumns } from '@ant-design/pro-components';
import ProTableWrapper from '@/components/ProTableWrapper';
import { getUserList, deleteUser, updateUserRole } from '@/services/ucenter/user';
import { Popconfirm } from 'antd';
import { errorMessage, successMessage } from '@/utils/msg';
import Edit, { EditAction } from './components/Edit';
import RoleSelect from './components/RoleSelect';

const UserList: React.FC = () => {
  const actionRef = useRef<ActionType>();
  const editRef = useRef<EditAction>(null);
  const [roleVisible, setRoleVisible] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [currentRole, setCurrentRole] = useState<string[]>([]); // ✅ 支持多角色

  const localEditFinish = async () => {
    actionRef.current?.reloadAndRest?.();
  };

  const columns: ProColumns[] = [
    {
      title: '用户标识',
      dataIndex: 'userCode',
    },
    {
      title: '手机',
      dataIndex: 'mobile',
    },
    {
      title: '邮箱',
      dataIndex: 'email',
    },
    {
      title: '姓名',
      dataIndex: 'realName',
    },
    {
      title: '昵称',
      dataIndex: 'nickName',
    },
    {
      title: '排序',
      dataIndex: 'orderNum',
      search: false,
    },
    {
      title: '操作',
      dataIndex: 'option',
      valueType: 'option',
      width: 200,
      fixed: 'right',
      className: 'option-wrap',
      render: (_, record) => [
        <a
          key="view"
          onClick={() => {
            editRef?.current?.show({ ...record, viewer: true });
          }}
        >
          查看
        </a>,
        <a
          key="edit"
          onClick={() => {
            editRef?.current?.show({ ...record });
          }}
        >
          编辑
        </a>,
        <Popconfirm
          title="确定要删除该用户吗？"
          onConfirm={async () => {
            const ret = await deleteUser(record.userCode);
            if (ret.code !== 0) {
              return errorMessage(ret.msg || '删除失败，请稍后再试');
            }
            successMessage('删除用户成功');
            actionRef?.current?.reloadAndRest?.();
          }}
          okText="确定"
          cancelText="取消"
          key="delete"
        >
          <a href="#">删除</a>
        </Popconfirm>,
        <a
          key="role"
          onClick={() => {
            setCurrentUser(record);
            setCurrentRole(record.groupCodes || []); // 从 record 中获取角色数组
            setRoleVisible(true);
          }}
        >
          角色
        </a>,
      ],
    },
  ];

  const handleRoleChange = async (roles: string[]) => {
    if (!currentUser) return;

    try {
      const userCode = String(currentUser.userCode);
      const result = await updateUserRole(userCode, roles);

      if (result.code === 0) {
        successMessage('角色分配成功');
        setRoleVisible(false);
        actionRef.current?.reloadAndRest?.();
      } else {
        errorMessage(result.msg || '角色分配失败');
      }
    } catch (error) {
      errorMessage('角色分配失败，请稍后再试');
    }
  };

  return (
    <PageContainer>
      <ProTableWrapper
        columns={columns}
        rowKey="userCode"
        actionRef={actionRef}
        request={async (params) => {
          const { current, pageSize, ...filter } = params;
          const data = await getUserList(current, pageSize, filter);
          return {
            data: data.rows,
            total: data.total,
            success: true,
          };
        }}
      />
      <Edit ref={editRef} onEditFinish={localEditFinish} />
      <RoleSelect
        visible={roleVisible}
        onCancel={() => setRoleVisible(false)}
        onConfirm={handleRoleChange}
        currentRole={currentRole}
      />
    </PageContainer>
  );
};

export default UserList;
