import React, {useState, useEffect, useImperativeHandle, ForwardRefRenderFunction} from 'react'
import {errorMessage, warnMessage} from '@/utils/msg'
import mime from 'mime'
import {Outlet, useModel} from '@umijs/max'
import {Upload} from 'antd'
import {getAccessToken} from '@/utils/authority'
import {
  ProFormUploadDragger,
  ProFormUploadButton,
  ProFormUploadDraggerProps,
  ProFormUploadButtonProps
} from '@ant-design/pro-components'
import {isNull} from '@/utils/util'

export type WrapperProps = ProFormUploadDraggerProps & ProFormUploadButtonProps & {
  /**
   * @description 要使用的Pro上传组件
   * @default ProFormUploadDragger
   *
   * @example Component={ProFormUploadDragger}
   */
  Component?: typeof ProFormUploadDragger | typeof ProFormUploadButton,
  /**
   * @description 支持上传的文件后缀
   * @default []
   *
   * @example fileExts={['.pdf', '.zip']}
   */
  fileExts?: string[],
  /**
   * @description 支持上传的文件mime
   * @default []
   *
   * @example fileMimeTypes={['image/jpeg', 'image/png']}
   */
  fileMimeTypes?: string[],
  /**
   * @description 支持最大的文件大小(单位：M)
   * @default 300
   *
   * @example fileSize={300}
   */
  fileSize?: number,
};

export type WrapperAction = {}

const Wrapper: ForwardRefRenderFunction<WrapperAction, WrapperProps> = (props, ref) => {
  const {
    Component = ProFormUploadDragger,
    readonly,
    fileExts = [],
    fileMimeTypes = [],
    fieldProps,
    fileSize = 300,
    ...otherProps
  } = props
  const [accept, setAccept] = useState<string[]>([])
  useEffect(() => {
    let mimeTypes = fileMimeTypes || []
    if (!isNull(fileExts)) {
      fileExts.forEach(t => {
        if (t === 'wps') {
          mimeTypes.push('application/kswps')
          return
        }
        let mimeType = mime.getType(t)
        if (mimeType) {
          mimeTypes.push(mimeType)
        }
      })
    }
    setAccept(mimeTypes)
  }, [])
  return (
    <Component
      fieldProps={{
        name: 'attach',
        listType: 'text',
        accept: accept.join(', '),
        beforeUpload: (file) => {
          const isAccept = accept.includes(file.type)
          if (!isAccept) {
            errorMessage('不支持的文件格式')
          }
          const isLt = file.size / 1024 / 1024 < fileSize
          if (!isLt) {
            errorMessage(`文件大小不超过${fileSize}M`)
          }
          return (isAccept && isLt) || Upload.LIST_IGNORE
        },
        headers: {'param-accessToken': getAccessToken()},
        onRemove: (file) => {
          return !readonly
        },
        onChange: ({file, fileList}) => {
          if (file.response && file.response.code !== 0) {
            file.status = 'error'
            errorMessage('上传失败：' + (file.response.msg || '请稍后再试'))
            fileList.splice(fileList.findIndex(_ => _.uid === file.uid), 1)
          }
        },
        ...fieldProps
      }}  // @ts-ignore
      action={DOC_API_BASE + '/file/upload/simple'}
      {...otherProps}
    >
      <Outlet/>
    </Component>
  )
}

export default React.forwardRef(Wrapper)
