import React, {createRef, useRef} from "react";
import {type ActionType, PageContainer, ProColumns} from "@ant-design/pro-components";
import ProTableWrapper from "@/components/ProTableWrapper";
import {getGroupList} from "@/services/ucenter/group";
import Edit, { EditAction } from "./components/Edit";
import GroupPri, { PrivilegeEditAction } from './components/GroupPri';
import {Button, Popconfirm} from "antd";
import {deleteGroup} from "@/services/ucenter/group";
import {errorMessage, successMessage} from "@/utils/msg";

const GroupList: React.FC = () => {
  const actionRef = useRef<ActionType>();
  const editRef = createRef<EditAction>();
  const priRef = useRef<PrivilegeEditAction>(null);

  const localEditFinish = async () => {
    actionRef.current?.reloadAndRest?.();
  };

  const localGroupPriFinish = async () => {
    actionRef.current?.reloadAndRest?.();
  };

  const columns: ProColumns[] = [
    {
      title: '角色标识',
      dataIndex: 'groupCode',
    },
    {
      title: '角色名称',
      dataIndex: 'groupName',
    },
    {
      title: '备注',
      dataIndex: 'description',
    },
    {
      title: '操作',
      dataIndex: 'option',
      valueType: 'option',
      width: 160,
      fixed: 'right',
      className: 'option-wrap',
      render: (_, record) => [
        <a
          key="view"
          onClick={() => {
            editRef?.current?.show({...record, viewer: true})
          }}
        >
          查看
        </a>,
        <a
          key="edit"
          onClick={() => {
            editRef?.current?.show({...record})
          }}
        >
          编辑
        </a>,
        <Popconfirm
          title="确定要删除该角色吗？"
          onConfirm={async () => {
            let ret = await deleteGroup(record.groupCode);
            if (ret.code !== 0) {
              let msg = ret.msg || '删除失败，请稍后再试';
              return errorMessage(msg);
            }
            successMessage('删除角色成功');
            actionRef?.current?.reloadAndRest?.();
          }}
          okText="确定"
          cancelText="取消"
          key="delete"
        >
          <a href='#'>删除</a>
        </Popconfirm>,
        <a
          key="permission"
          onClick={() => {
            priRef?.current?.show({...record});
          }}
        >
          权限
        </a>
      ],
    },
  ]

  return (
    <PageContainer>
      <ProTableWrapper
        columns={columns}
        rowKey='groupCode'
        actionRef={actionRef}
        request={async (paramsIn, sorter, filterIn) => {
          /*console.log(paramsIn, sorter, filterIn);*/
          let filter = {...paramsIn};
          delete filter.current;
          delete filter.pageSize;

          let data = await getGroupList(paramsIn.current, paramsIn.pageSize, filter);
          return {
            data: data.rows,
            total: data.total,
            success: true
          }
        }}
        toolBarRender={() => [
          <Button type="primary" key="add" onClick={() => {
            editRef?.current?.show()
          }}>
            添加角色
          </Button>,
        ]}
      />
      <Edit ref={editRef} onEditFinish={localEditFinish} />
      <GroupPri ref={priRef} onSubmit={localGroupPriFinish} />
    </PageContainer>
  )
}

export default GroupList;
