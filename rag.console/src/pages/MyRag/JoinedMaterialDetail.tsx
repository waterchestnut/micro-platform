import React from 'react'
import MaterialDetail from '@/pages/Rag/MaterialDetail'
import {history} from '@@/core/history'
import {useSearchParams} from '@umijs/max'

const JoinedMaterialDetail: React.FC = () => {
  const [searchParams] = useSearchParams()
  const isViewMode = searchParams.get('view') === '1'
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
    <MaterialDetail apiRelativeUrls={apiRelativeUrls} toBack={(ragCode: string) => {
      history.push(`/my-rag-joined/detail/${ragCode}${isViewMode ? '?view=1' : ''}`)
    }}/>
  )
}

export default JoinedMaterialDetail
