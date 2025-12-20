/**
 * @fileOverview 文件管理的接口调用
 * @author xianyang 2025/11/17
 * @module
 */

import {docRequest} from '@/services/request'

/*覆盖式上传文件*/
export async function uniqueUploadFile(fileCode: string, formData: FormData) {
  return docRequest(`/file/upload/unique?fileCode=${fileCode}`, {
    method: 'POST',
    data: formData,
  })
}

/*普通单文件上传*/
export async function simpleUploadFile(file: File, exts: any = {}) {
  const formData = new FormData()
  formData.append('file', file)
  for (let key in exts) {
    formData.append(key, exts[key])
  }
  return docRequest(`/file/upload/simple`, {
    method: 'POST',
    data: formData,
  })
}

/*单文件对象覆盖上传*/
export async function simpleUniqueUploadFile(fileCode: string, file: File, exts: any = {}) {
  const formData = new FormData()
  formData.append('file', file)
  for (let key in exts) {
    formData.append(key, exts[key])
  }
  return docRequest(`/file/upload/unique?fileCode=${fileCode}`, {
    method: 'POST',
    data: formData,
  })
}
