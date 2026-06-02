import React from 'react'
import RagInfoDetail from '@/pages/Rag/Detail'
import {history} from '@@/core/history'

const JoinedRagInfoDetail: React.FC = () => {
  const apiRelativeUrls: any = {
    getRagInfo: '/core/rag-my/detail',
    getRagMaterialList: '/core/rag-my/material/list',
    getRagMaterial: '/core/rag-my/material/detail',
    getRagSegmentList: '/core/rag-my/segment/list',
    getRagSegment: '/core/rag-my/segment/detail',
    getRagChunkList: '/core/rag-my/chunk/list',
    getRagChunk: '/core/rag-my/chunk/detail',
  }
  return (
    <RagInfoDetail apiRelativeUrls={apiRelativeUrls} toBack={() => {
      history.push('/my-rag-joined/list')
    }} toMaterialDetail={(ragCode: string, ragMaterialCode: string) => {
      history.push(`/my-rag-joined/detail/${ragCode}/${ragMaterialCode}`)
    }}/>
  )
}

export default JoinedRagInfoDetail
