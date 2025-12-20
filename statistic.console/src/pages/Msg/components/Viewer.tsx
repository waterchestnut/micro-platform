import React, {ForwardRefRenderFunction, useImperativeHandle, useRef, useState} from 'react'
import {Drawer, Modal} from 'antd'
import ReactJsonView from '@microlink/react-json-view'

export type ViewerProps = {
  onClose?: (msgData?: any) => Promise<void>;
  title?: string;
};

export type ViewerAction = {
  show: (record?: any) => void;
  close: () => void;
}

const Viewer: ForwardRefRenderFunction<ViewerAction, ViewerProps> = (props, ref) => {
  const {onClose, title} = props
  const [isOpen, setIsOpen] = useState(false)
  const [msgInfo, setMsgInfo] = useState<any>(null)

  const handleCancel = () => {
    setIsOpen(false)
    onClose && onClose()
  }

  useImperativeHandle(ref, () => ({
    show: async (info: any) => {
      setMsgInfo(info || null)
      setIsOpen(true)
    },
    close: () => {
      handleCancel()
    }
  }))

  return (
    <Drawer
      title='日志详情'
      open={isOpen}
      closable={{placement: 'end'}}
      onClose={handleCancel}
      forceRender={true}
      size='large'
    >
      <ReactJsonView
        src={msgInfo || {}}
      />
    </Drawer>
  )
}

export default React.forwardRef(Viewer)
