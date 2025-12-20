import React, {createRef, ForwardRefRenderFunction, useImperativeHandle, useState} from 'react'
import BaseInfo, {BaseInfoAction} from '@/pages/Client/components/BaseInfo'
import {Modal} from 'antd'

export type EditProps = {
  onEditFinish?: (resData?: any) => Promise<void>;
  apiRelativeUrls?: any;
};

export type EditAction = {
  show: (record?: any) => void;
  close: () => void;
}

const Edit: ForwardRefRenderFunction<EditAction, EditProps> = (props, ref) => {
  const {onEditFinish, apiRelativeUrls} = props
  const [isOpen, setIsOpen] = useState(false)
  const [clientInfo, setClientInfo] = useState<any>(null)
  const baseInfoRef = createRef<BaseInfoAction>()

  const handleCancel = () => {
    setIsOpen(false)
  }

  useImperativeHandle(ref, () => ({
    show: async (info: any) => {
      setClientInfo(info || null)
      setIsOpen(true)
      baseInfoRef.current?.show(info)
    },
    close: () => {
      handleCancel()
    }
  }))

  return (
    <Modal
      title={(clientInfo ? clientInfo.viewer ? '查看' : '编辑' : '新建') + '应用'}
      open={isOpen}
      onCancel={handleCancel}
      centered={true}
      destroyOnClose={true}
      forceRender={true}
      footer={null}
      width={900}
    >
      <BaseInfo
        ref={baseInfoRef}
        onEditFinish={async () => {
          if (onEditFinish) {
            await onEditFinish()
          }
          setIsOpen(false)
        }}
        onEditCancel={() => {
          handleCancel()
        }}
        apiRelativeUrls={apiRelativeUrls}
      />
    </Modal>
  )
}

export default React.forwardRef(Edit)
