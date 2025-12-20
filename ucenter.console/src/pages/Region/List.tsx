import React, {createRef, useRef} from "react";
import {type ActionType, PageContainer, ProColumns} from "@ant-design/pro-components";
import ProTableWrapper from "@/components/ProTableWrapper";
import {deleteRegion, getRegionList} from "@/services/ucenter/region";
import Edit, {EditAction} from "./components/Edit";
import {Button, Popconfirm} from "antd";
import {errorMessage, successMessage} from "@/utils/msg";

const RegionList: React.FC = () => {
  const actionRef = useRef<ActionType>();
  const editRef = createRef<EditAction>();

  const localEditFinish = async () => {
    actionRef.current?.reloadAndRest?.();
  };

  const columns: ProColumns[] = [
    {
      title: '地区标识',
      dataIndex: 'regionCode',
      fixed: 'left',
      width: 80,
    },
    {
      title: '地区名称',
      dataIndex: 'regionName',
    },
    {
      title: '全名',
      dataIndex: 'fullName',
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
      title: '层级',
      dataIndex: 'levelNum',
      search: false,
    },
    {
      title: '排序',
      dataIndex: 'orderNum',
      search: false,
    },
    {
      title: '行政编号',
      dataIndex: 'adminCode',
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
          title="确定要删除该地区吗？"
          onConfirm={async () => {
            let ret = await deleteRegion(record.regionCode);
            if (ret.code !== 0) {
              let msg = ret.msg || '删除失败，请稍后再试';
              return errorMessage(msg);
            }
            successMessage('删除地区成功');
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
        rowKey='regionCode'
        actionRef={actionRef}
        request={async (paramsIn, sorter, filterIn) => {
          /*console.log(paramsIn, sorter, filterIn);*/
          let filter = {...paramsIn};
          delete filter.current;
          delete filter.pageSize;

          let data = await getRegionList(paramsIn.current, paramsIn.pageSize, filter, {
            sort: {
              levelNum: 1,
              orderNum: 1
            }
          });
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
            添加地区
          </Button>,
        ]}
      />
      <Edit ref={editRef} onEditFinish={localEditFinish}/>
    </PageContainer>
  )
}

export default RegionList;
