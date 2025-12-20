/**
 * @fileOverview 文献阅读相关的接口调用
 * @author xianyang
 * @module
 */

import {resourceRequest} from '@/services/request'

/** 核验文献资源的准备情况 */
export async function checkResLiterature(resCode: string): Promise<any> {
  try {
    let ret = await resourceRequest('/core/literature/check', {
      method: 'POST',
      data: {resCode}
    })

    return ret
  } catch (e: any) {
    return e?.response?.data
  }
}

/** 本地文件上传后进行文献解读 */
export async function localFileLiterature(fileInfo: any): Promise<any> {
  try {
    let ret = await resourceRequest('/core/literature/local-file', {
      method: 'POST',
      data: {fileInfo}
    })

    return ret
  } catch (e: any) {
    return e?.response?.data
  }
}

/** 删除文献解读历史记录 */
export async function removeLiterature(resCode: string): Promise<any> {
  try {
    let ret = await resourceRequest('/core/literature/remove', {
      method: 'POST',
      data: {resCode}
    })

    return ret
  } catch (e: any) {
    return e?.response?.data
  }
}
