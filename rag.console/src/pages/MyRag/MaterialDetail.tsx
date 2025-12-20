import React from 'react'
import MaterialDetail from '@/pages/Rag/MaterialDetail'
import {history} from '@@/core/history'

const MyMaterialDetail: React.FC = () => {
  const apiRelativeUrls: any = {
    getRagInfoList: '/core/rag-my/list',
    addRagInfo: '/core/rag-info/add',
    updateRagInfo: '/core/rag-my/update',
    deleteRagInfo: '/core/rag-my/delete',
    enableRagInfo: '/core/rag-my/enable',
    disableRagInfo: '/core/rag-my/disable',
    getRagInfo: '/core/rag-my/detail',
    getRagMaterialList: '/core/rag-my/material/list',
    addRagMaterial: '/core/rag-my/material/add',
    updateRagMaterial: '/core/rag-my/material/update',
    deleteRagMaterial: '/core/rag-my/material/delete',
    enableRagMaterial: '/core/rag-my/material/enable',
    disableRagMaterial: '/core/rag-my/material/disable',
    getRagMaterial: '/core/rag-my/material/detail',
    getRagSegmentList: '/core/rag-my/segment/list',
    addRagSegment: '/core/rag-my/segment/add',
    updateRagSegment: '/core/rag-my/segment/update',
    deleteRagSegment: '/core/rag-my/segment/delete',
    enableRagSegment: '/core/rag-my/segment/enable',
    disableRagSegment: '/core/rag-my/segment/disable',
    getRagSegment: '/core/rag-my/segment/detail',
    getRagChunkList: '/core/rag-my/chunk/list',
    addRagChunk: '/core/rag-my/chunk/add',
    updateRagChunk: '/core/rag-my/chunk/update',
    deleteRagChunk: '/core/rag-my/chunk/delete',
    enableRagChunk: '/core/rag-my/chunk/enable',
    disableRagChunk: '/core/rag-my/chunk/disable',
    getRagChunk: '/core/rag-my/chunk/detail',
  }
  return (
    <MaterialDetail apiRelativeUrls={apiRelativeUrls} toBack={(ragCode: string) => {
      history.push(`/my-rag/detail/${ragCode}`)
    }}/>
  )
}

export default MyMaterialDetail
