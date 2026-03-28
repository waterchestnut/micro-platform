import React, {createRef, useRef} from "react";
import {type ActionType, PageContainer, ProColumns} from "@ant-design/pro-components";
import ProTableWrapper from "@/components/ProTableWrapper";
import {deleteAgreement, getAgreementList} from "@/services/ucenter/agreement";
import Edit, {EditAction} from "./components/Edit";
import {Button, Popconfirm} from "antd";
import {errorMessage, successMessage} from "@/utils/msg";
import AgreementTypeEnum from "@/enum/AgreementTypeEnum";
import StatusEnum from "@/enum/StatusEnum";

const AgreementList: React.FC = () => {
  const actionRef = useRef<ActionType>();
  const editRef = createRef<EditAction>();

  const localEditFinish = async () => {
    actionRef.current?.reloadAndRest?.();
  };

  const columns: ProColumns[] = [
    {
      title: '协议标识',
      dataIndex: 'agreementCode',
    },
    {
      title: '协议标题',
      dataIndex: 'title',
      search: false,
    },
    {
      title: '协议类型',
      dataIndex: 'type',
      valueEnum: AgreementTypeEnum.toValueEnum(),
    },
    {
      title: '版本号',
      dataIndex: 'version',
      search: false,
    },
    {
      title: '状态',
      dataIndex: 'status',
      valueEnum: StatusEnum.toValueEnum(),
      search: false,
    },
    {
      title: '生效时间',
      dataIndex: 'effectiveTime',
      valueType: 'date',
      search: false,
    },
    {
      title: '创建时间',
      dataIndex: 'insertTime',
      valueType: 'dateTime',
      search: false,
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
          title="确定要删除该协议吗？"
          onConfirm={async () => {
            let ret = await deleteAgreement(record.agreementCode);
            if (ret.code !== 0) {
              let msg = ret.msg || '删除失败，请稍后再试';
              return errorMessage(msg);
            }
            successMessage('删除协议成功');
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
        rowKey='agreementCode'
        actionRef={actionRef}
        request={async (paramsIn, sorter, filterIn) => {
          let filter = {...paramsIn};
          delete filter.current;
          delete filter.pageSize;

          let data = await getAgreementList(paramsIn.current, paramsIn.pageSize, filter);
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
            添加协议
          </Button>,
        ]}
      />
      <Edit ref={editRef} onEditFinish={localEditFinish}/>
    </PageContainer>
  )
}

export default AgreementList;
