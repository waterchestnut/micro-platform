import React, {useState, useEffect} from 'react'
import {
  ProFormUploadDragger
} from '@ant-design/pro-components'
import UploadWrapper, {WrapperProps} from './index'

export default (props: WrapperProps) => {
  return (
    <UploadWrapper
      {...props}
      Component={ProFormUploadDragger}
    />
  )
};
