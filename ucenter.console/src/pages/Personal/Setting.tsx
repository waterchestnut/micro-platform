import React, {useEffect, useState} from 'react'
import {Card} from 'antd'
import {queryCurrentUser} from '@/services/ucenter/user'
import MobileEdit from './components/MobileEdit'
import EmailEdit from './components/EmailEdit'

interface UserInfo {
  mobile?: string
  email?: string
}

const Setting: React.FC = () => {
  const [userInfo, setUserInfo] = useState<UserInfo>({})
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  const fetchUserInfo = async () => {
    setLoading(true)
    try {
      const res = await queryCurrentUser()
      if (res.code === 0 && res.data) {
        setUserInfo({
          mobile: res.data.mobile,
          email: res.data.email,
        })
      }
    } catch (error) {
      console.error('获取用户信息失败', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchUserInfo()
  }, [])

  const handleRefresh = () => {
    setRefreshKey(prev => prev + 1)
    fetchUserInfo()
  }

  return (
    <div key={refreshKey}>
      <MobileEdit
        mobile={userInfo.mobile}
        onEditFinish={handleRefresh}
      />
      <EmailEdit
        email={userInfo.email}
        onEditFinish={handleRefresh}
      />
    </div>
  )
}

export default Setting
