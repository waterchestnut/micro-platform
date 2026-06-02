import React, {useEffect, useState} from 'react'
import {Button, Result, Spin} from 'antd'
import {useParams, history, useModel} from '@umijs/max'
import {getRagInfo} from '@/services/rag/ragInfo'
import {applyJoin} from '@/services/rag/ragMember'

const JoinPage: React.FC = () => {
  const params = useParams()
  const {initialState} = useModel('@@initialState')
  const currentUser = initialState?.currentUser
  const [loading, setLoading] = useState(true)
  const [ragInfo, setRagInfo] = useState<any>(null)
  const [joinResult, setJoinResult] = useState<{type: 'success' | 'pending' | 'error' | 'already', message?: string} | null>(null)
  const [joining, setJoining] = useState(false)

  useEffect(() => {
    if (!params.ragCode) {
      history.push('/404')
      return
    }
    getRagInfo(params.ragCode, '/core/rag-my/detail').then(info => {
      if (!info?.ragCode) {
        setJoinResult({type: 'error', message: '知识库不存在或已被删除'})
        setLoading(false)
        return
      }
      setRagInfo(info)
      let isMember = info.members?.some((m: any) => m.userCode === currentUser?.userCode)
      if (isMember) {
        setJoinResult({type: 'already'})
      }
      setLoading(false)
    }).catch(() => {
      setJoinResult({type: 'error', message: '知识库不存在或无权限访问'})
      setLoading(false)
    })
  }, [params.ragCode, currentUser?.userCode])

  const handleJoin = async () => {
    if (!params.ragCode) return
    setJoining(true)
    try {
      let ret = await applyJoin(params.ragCode, '/core/rag-my/application/apply')
      if (ret.code !== 0) {
        let msg = ret.msg || '加入失败'
        if (msg.includes('已是知识库成员')) {
          setJoinResult({type: 'already'})
        } else if (msg.includes('待审批')) {
          setJoinResult({type: 'pending'})
        } else {
          setJoinResult({type: 'error', message: msg})
        }
      } else if (ret.data?.needApproval === 0) {
        setJoinResult({type: 'success'})
      } else {
        setJoinResult({type: 'pending'})
      }
    } catch (e: any) {
      setJoinResult({type: 'error', message: e?.message || '加入失败，请稍后再试'})
    }
    setJoining(false)
  }

  if (loading) {
    return <div style={{textAlign: 'center', padding: 100}}><Spin size='large'/></div>
  }

  if (joinResult?.type === 'success') {
    return (
      <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh'}}>
        <Result
          status='success'
          title='加入成功'
          subTitle={`您已成功加入知识库「${ragInfo?.title}」`}
          extra={[
            <Button type='primary' key='go' onClick={() => history.push(`/my-rag-joined/detail/${params.ragCode}`)}>
              进入知识库
            </Button>,
            <Button key='list' onClick={() => history.push('/my-rag-joined/list')}>
              我加入的知识库
            </Button>,
          ]}
        />
      </div>
    )
  }

  if (joinResult?.type === 'pending') {
    return (
      <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh'}}>
        <Result
          status='info'
          title='已提交申请'
          subTitle={`您已申请加入知识库「${ragInfo?.title}」，请等待管理员审批。`}
          extra={[
            <Button type='primary' key='list' onClick={() => history.push('/my-rag-joined/list')}>
              我加入的知识库
            </Button>,
          ]}
        />
      </div>
    )
  }

  if (joinResult?.type === 'already') {
    return (
      <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh'}}>
        <Result
          status='info'
          title='您已是该知识库成员'
          subTitle={`您已在知识库「${ragInfo?.title}」中`}
          extra={[
            <Button type='primary' key='go' onClick={() => history.push(`/my-rag-joined/detail/${params.ragCode}`)}>
              进入知识库
            </Button>,
          ]}
        />
      </div>
    )
  }

  if (joinResult?.type === 'error') {
    return (
      <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh'}}>
        <Result
          status='error'
          title='加入失败'
          subTitle={joinResult.message}
          extra={[
            <Button type='primary' key='home' onClick={() => history.push('/home')}>
              返回首页
            </Button>,
          ]}
        />
      </div>
    )
  }

  return (
    <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh'}}>
      <Result
        icon={<span style={{fontSize: 48}}>📚</span>}
        title={`加入知识库「${ragInfo?.title}」`}
        subTitle={ragInfo?.description || '点击下方按钮加入该知识库'}
        extra={
          <Button type='primary' size='large' loading={joining} onClick={handleJoin}>
            {ragInfo?.needApproval === 0 ? '立即加入' : '申请加入'}
          </Button>
        }
      />
    </div>
  )
}

export default JoinPage
