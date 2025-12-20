import React, {createRef, useRef} from "react";
import {type ActionType, PageContainer, ProColumns} from "@ant-design/pro-components";
import ProTableWrapper from "@/components/ProTableWrapper";
import {getPrivList} from "@/services/ucenter/priv";
import Edit, {EditAction} from "./components/PrivEdit";
import {Button, Popconfirm} from "antd";
import {deletePriv} from "@/services/ucenter/priv";
import {errorMessage, successMessage} from "@/utils/msg";
import {getClientList} from "@/services/ucenter/client";
import {getModuleList} from "@/services/ucenter/module";

const PrivList: React.FC = () => {
  const actionRef = useRef<ActionType>();
  const editRef = createRef<EditAction>();

  const localEditFinish = async () => {
    actionRef.current?.reloadAndRest?.();
  };

  const columns: ProColumns[] = [
    {
      title: '权限标识',
      dataIndex: 'modulePrivCode',
    },
    {
      title: '权限名称',
      dataIndex: 'modulePrivName',
    },
    {
      title: '所属应用',
      dataIndex: 'clientName',
      search: false,
    },
    {
      title: '所属应用',
      key: 'clientCode',
      hideInTable: true,
      valueType: 'select',
      fieldProps: {
        showSearch: true
      },
      request: async (params) => {
        /*console.log(params);*/
        let data = await getClientList(1, 60, {clientName: params.keyWords});
        return (data.rows || []).map((client: any) => ({label: client.clientName, value: client.clientCode}));
      },
      debounceTime: 600,
    },
    {
      title: '所属模块',
      dataIndex: 'moduleName',
      search: false,
    },
    {
      title: '所属模块',
      key: 'moduleCode',
      hideInTable: true,
      valueType: 'select',
      fieldProps: {
        showSearch: true
      },
      request: async (params) => {
        /*console.log(params);*/
        let data = await getModuleList(1, 10, {moduleName: params.keyWords});
        return (data.rows || []).map((client: any) => ({label: client.moduleName, value: client.moduleCode}));
      },
      debounceTime: 600,
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
          title="确定要删除该权限吗？"
          onConfirm={async () => {
            let ret = await deletePriv(record.privCode);
            if (ret.code !== 0) {
              let msg = ret.msg || '删除失败，请稍后再试';
              return errorMessage(msg);
            }
            successMessage('删除权限成功');
            actionRef?.current?.reloadAndRest?.();
          }}
          okText="确定"
          cancelText="取消"
          key="delete"
        >
          <a href='#'>删除</a>
        </Popconfirm>
      ],
    },
  ]

  return (
    <PageContainer>
      <ProTableWrapper
        columns={columns}
        rowKey='modulePrivCode'
        actionRef={actionRef}
        request={async (paramsIn, sorter, filterIn) => {
          /*console.log(paramsIn, sorter, filterIn);*/
          let filter = {...paramsIn};
          delete filter.current;
          delete filter.pageSize;

          let data = await getPrivList(paramsIn.current, paramsIn.pageSize, filter, {withFormat: 1});
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
            添加权限
          </Button>,
        ]}
      />
      <Edit ref={editRef} onEditFinish={localEditFinish}/>
    </PageContainer>
  )
}

export default PrivList;
