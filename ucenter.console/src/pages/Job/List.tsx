import React, {createRef, useRef} from "react";
import {type ActionType, PageContainer, ProColumns} from "@ant-design/pro-components";
import ProTableWrapper from "@/components/ProTableWrapper";
import {getJobList} from "@/services/ucenter/job";
import Edit, {EditAction} from "./components/Edit";
import {Button, Popconfirm} from "antd";
import {deleteJob} from "@/services/ucenter/job";
import {errorMessage, successMessage} from "@/utils/msg";

const JobList: React.FC = () => {
  const actionRef = useRef<ActionType>();
  const editRef = createRef<EditAction>();

  const localEditFinish = async () => {
    actionRef.current?.reloadAndRest?.();
  };

  const columns: ProColumns[] = [
    {
      title: '职位标识',
      dataIndex: 'jobCode',
    },
    {
      title: '职位名称',
      dataIndex: 'jobName',
    },
    {
      title: '职位层级',
      dataIndex: 'levelNum',
    },
    {
      title: '父节点',
      dataIndex: 'parentCode',
    },
    {
      title: '节点路径',
      dataIndex: 'path',
      render: (text, record) => {
        if (!record?.path?.length) {
          return '-';
        }
        return record.path.join('=>')
      }
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
          title="确定要删除该职位吗？"
          onConfirm={async () => {
            let ret = await deleteJob(record.jobCode);
            if (ret.code !== 0) {
              let msg = ret.msg || '删除失败，请稍后再试';
              return errorMessage(msg);
            }
            successMessage('删除职位成功');
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
        rowKey='jobCode'
        actionRef={actionRef}
        request={async (paramsIn, sorter, filterIn) => {
          /*console.log(paramsIn, sorter, filterIn);*/
          let filter = {...paramsIn};
          delete filter.current;
          delete filter.pageSize;

          let data = await getJobList(paramsIn.current, paramsIn.pageSize, filter);
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
            添加职位
          </Button>,
        ]}
      />
      <Edit ref={editRef} onEditFinish={localEditFinish}/>
    </PageContainer>
  )
}

export default JobList;
