import React, { ForwardRefRenderFunction, useImperativeHandle, useRef, useState } from 'react';
import {
  ModalForm,
  ProFormInstance,
} from '@ant-design/pro-components';
import { Card, Checkbox, Row, Col, Space } from 'antd';
import type { DataNode } from 'antd/es/tree';
import { getPrivList } from '@/services/ucenter/priv';
import { errorMessage, successMessage } from '@/utils/msg';
import { updateGroup } from '@/services/ucenter/group';
import { getModuleList } from '@/services/ucenter/module';
import { getClientList } from '@/services/ucenter/client';

type PrivItem = {
  modulePrivCode: string;
  modulePrivName: string;
  moduleCode: string;
  privVerb: string;
  status: number;
  authType: number;
  clientCode: string;
  moduleName: string;
  clientName: string;
};

export type PrivilegeEditProps = {
  onSubmit?: (checkedKeys: string[]) => Promise<void>;
};

export type PrivilegeEditAction = {
  show: (record: any) => void;
  close: () => void;
};

const PrivilegeEdit: ForwardRefRenderFunction<PrivilegeEditAction, PrivilegeEditProps> = (props, ref) => {
  const { onSubmit } = props;
  const [open, setOpen] = useState(false);
  const formRef = useRef<ProFormInstance>();
  const [checkedKeys, setCheckedKeys] = useState<React.Key[]>([]);
  const [selectedClient, setSelectedClient] = useState<string>();
  const [treeDataMap, setTreeDataMap] = useState<Record<string, DataNode[]>>({}); // 存储权限树数据
  const [clientMap, setClientMap] = useState<Record<string, string>>({}); // 存储客户端名称
  const [recordData, setRecordData] = useState<any>({});

  // 加载权限数据
  const loadPrivileges = async () => {
    try {
      const [privResult, clientResult, moduleResult] = await Promise.all([
        getPrivList(1, 9999),
        getClientList(1, 9999),
        getModuleList(1, 9999),
      ]);

      // 构建 clientCode -> clientName 映射
      const clientNameMap: Record<string, string> = {};
      (clientResult?.rows || []).forEach((item: { clientCode: string; clientName: string }) => {
        clientNameMap[item.clientCode] = item.clientName;
      });

      // 构建 moduleCode -> moduleName 映射
      const moduleNameMap: Record<string, string> = {};
      (moduleResult?.rows || []).forEach((item: { moduleCode: string; moduleName: string }) => {
        moduleNameMap[item.moduleCode] = item.moduleName;
      });

      // 替换 privList 中的 clientName 和 moduleName
      const rows = (privResult?.rows || []).map((item: PrivItem) => ({
        ...item,
        clientName: clientNameMap[item.clientCode] || item.clientCode,
        moduleName: moduleNameMap[item.moduleCode] || item.moduleCode,
      })) as PrivItem[];

      const clientMapByModules: Record<string, Record<string, PrivItem[]>> = {};
      rows.forEach((item: PrivItem) => {
        if (!clientMapByModules[item.clientCode]) {
          clientMapByModules[item.clientCode] = {};
        }
        if (!clientMapByModules[item.clientCode][item.moduleCode]) {
          clientMapByModules[item.clientCode][item.moduleCode] = [];
        }
        clientMapByModules[item.clientCode][item.moduleCode].push(item);
      });

      const dataMap: Record<string, DataNode[]> = {};
      Object.entries(clientMapByModules).forEach(([clientCode, modules]) => {
        dataMap[clientCode] = Object.entries(modules).map(([moduleCode, privs]) => ({
          title: privs[0]?.moduleName || moduleCode,
          key: `${clientCode}-${moduleCode}`,
          children: privs.map((priv) => ({
            title: priv.modulePrivName,
            key: priv.modulePrivCode,
            isLeaf: true,
          })),
        }));
      });

      setTreeDataMap(dataMap);
      setClientMap(clientNameMap);
      const firstClient = Object.keys(dataMap)[0];
      setSelectedClient(firstClient);
    } catch (e) {
      errorMessage('加载权限失败');
    }
  };

  useImperativeHandle(ref, () => ({
    show: (record) => {
      const { groupCode, groupName, modulePrivCodes = [] } = record;
      setRecordData(record); // 保存所有信息
      setCheckedKeys(modulePrivCodes);
      setOpen(true);
      loadPrivileges();
    },
    close: () => {
      setOpen(false);
    },
  }));

  const handleOk = async () => {
    try {
      const payload = {
        ...recordData,
        modulePrivCodes: checkedKeys,
      };
      const result = await updateGroup(payload);

      if (result?.code === 0) {
        successMessage('权限保存成功');
        setOpen(false);
        onSubmit?.(checkedKeys as string[]);
      } else {
        errorMessage(result?.msg || '权限保存失败');
      }
    } catch (error) {
      errorMessage('权限保存失败，请稍后重试');
    }
  };

  return (
    <ModalForm
      title={
        <div style={{ fontSize: 16, fontWeight: 700 }}>
          权限设置 - {recordData.groupName || ''}
        </div>
      }
      open={open}
      modalProps={{
        onCancel: () => setOpen(false),
        centered: true,
        destroyOnClose: true,
        width: 800,
      }}
      formRef={formRef}
      onFinish={handleOk}
    >
      <div style={{ display: 'flex', minHeight: 400 }}>
        <div style={{ width: 160, marginRight: 24 }}>
          {Object.keys(treeDataMap).map((clientCode) => {
            const clientName = clientMap[clientCode] || clientCode;
            return (
              <Card
                key={clientCode}
                hoverable
                style={{
                marginBottom: 8,
                cursor: 'pointer',
                background: selectedClient === clientCode ? '#ffcccc' : '#fff', 
                height: 48,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                padding: 0,
                fontWeight: 700,
                fontSize: 15,
              }}
                onClick={() => setSelectedClient(clientCode)}
              >
                {clientName}
              </Card>
            );
          })}
        </div>
        <div style={{ flex: 1 }}>
          {selectedClient && (
            <div>
              {treeDataMap[selectedClient].map((module: DataNode) => {
                const allKeys = (module.children || []).map((priv) => priv.key);
                const allChecked = allKeys.every((key) => checkedKeys.includes(key));
                const partiallyChecked = allKeys.some((key) => checkedKeys.includes(key)) && !allChecked;

                const toggleSelectAll = () => {
                  if (allChecked) {
                    setCheckedKeys(checkedKeys.filter((key) => !allKeys.includes(key)));
                  } else {
                    const newKeys = Array.from(new Set([...checkedKeys, ...allKeys]));
                    setCheckedKeys(newKeys);
                  }
                };

                return (
                  <div key={module.key} style={{ marginBottom: 24 }}>
                    <Space align="center" style={{ width: '100%' }}>
                      <span style={{ fontWeight: 'bold', fontSize: '15px' }}>{String(module.title)}</span>
                      <span style={{ cursor: 'pointer', fontWeight: 700, fontSize: '15px' }} onClick={toggleSelectAll}>
                        （&nbsp; 
                        <Checkbox
                          checked={allChecked}
                          indeterminate={partiallyChecked}
                          style={{ marginRight: 4 }}
                        />
                        全选 / 反选 ）
                      </span>
                    </Space>
                    <Checkbox.Group
                      value={checkedKeys.filter((key) => allKeys.includes(key))}
                      onChange={(currentModuleChecked) => {
                        const otherKeys = checkedKeys.filter((key) => !allKeys.includes(key));
                        const newKeys = [...new Set([...otherKeys, ...(currentModuleChecked as string[])])];
                        setCheckedKeys(newKeys);
                      }}
                    >
                      <Row gutter={[16, 8]} style={{ marginTop: 8 }}>
                        {module.children?.map((priv) => (
                          <Col span={24} key={priv.key}>
                            <Checkbox value={priv.key}>{String(priv.title)}</Checkbox>
                          </Col>
                        ))}
                      </Row>
                    </Checkbox.Group>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </ModalForm>
  );
};

export default React.forwardRef(PrivilegeEdit);
