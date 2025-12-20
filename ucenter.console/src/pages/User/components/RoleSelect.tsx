import React, { useState, useEffect } from 'react';
import { Select, Modal } from 'antd';
import { getGroupList } from '@/services/ucenter/group';

interface RoleSelectProps {
  visible: boolean;
  onCancel: () => void;
  onConfirm: (roles: string[]) => void;
  currentRole?: string[];
}

interface RoleOption {
  label: string;
  value: string;
}

const RoleSelect: React.FC<RoleSelectProps> = ({ visible, onCancel, onConfirm, currentRole }) => {
  const [selectedRoles, setSelectedRoles] = useState<string[]>(currentRole || []);
  const [roleOptions, setRoleOptions] = useState<RoleOption[]>([]);

  useEffect(() => {
    setSelectedRoles(currentRole || []);
  }, [currentRole]);

  useEffect(() => {
    const fetchRoles = async () => {
      const res = await getGroupList(1, 100, {});
      if (res?.rows) {
        const options = res.rows.map((item: any) => ({
          label: item.groupName,
          value: item.groupCode,
        }));
        setRoleOptions(options);
      }
    };

    if (visible) {
      fetchRoles();
    }
  }, [visible]);

  const handleConfirm = () => {
    onConfirm(selectedRoles);
  };

  return (
    <Modal
      visible={visible}
      title="选择角色"
      onCancel={onCancel}
      onOk={handleConfirm}
      okText="保存"
      cancelText="取消"
    >
      <Select
        mode="multiple"
        value={selectedRoles}
        onChange={setSelectedRoles}
        style={{ width: '100%' }}
        placeholder="请选择角色"
        loading={roleOptions.length === 0}
      >
        {roleOptions.map(option => (
          <Select.Option key={option.value} value={option.value}>
            {option.label}
          </Select.Option>
        ))}
      </Select>
    </Modal>
  );
};

export default RoleSelect;
