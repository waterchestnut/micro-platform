import React, {useState, useEffect} from 'react'
import {
  ProFormUploadButton
} from '@ant-design/pro-components'
import UploadWrapper, {WrapperProps} from './index'

export default (props: WrapperProps) => {
  return (
    <UploadWrapper
      {...props}
      Component={ProFormUploadButton}
    />
  )
};
