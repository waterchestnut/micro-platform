/**
 * @fileOverview 系统的角色加载等
 * @author menglb
 * @module role
 */

import {getRoles} from '@/services/ucenter/role'
import {useEffect, useState} from 'react'

export default function Model() {
  const [roles, setRoles] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getRoles().then((res) => {
      setRoles(res)
      setLoading(false)
    })
  }, [])

  return {
    roles,
    loading,
  }
}
