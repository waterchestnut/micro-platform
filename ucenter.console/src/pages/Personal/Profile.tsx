import React, {useEffect, useRef, useState} from 'react'
import {
  ProForm,
  ProFormDatePicker,
  ProFormGroup,
  ProFormSelect,
  ProFormText,
  ProFormUploadButton,
} from '@ant-design/pro-components'
import {Button, Card, Col, Row, Space, Upload} from 'antd'
import {formatUploadFile, getDocHttpUrl, waitTime} from '@/utils/util'
import {queryCurrentUser, updateCurrentUser} from '@/services/ucenter/user'
import {errorMessage, successMessage} from '@/utils/msg'
import {getAccessToken} from '@/utils/authority'
import GenderEnum from '@/enum/GenderEnum'
import DegreeEnum from '@/enum/DegreeEnum'
import NationEnum from '@/enum/NationEnum'
import PoliticsEnum from '@/enum/PoliticsEnum'
import dayjs from 'dayjs'

interface UserInfo {
  avatarUrl?: string;
  realName?: string;
  nickName?: string;
  userCode?: string;
  orgName?: string;
  major?: string;
  grade?: string;
  nation?: number | string;
  politics?: number | string;
  birthday?: string;
  gender?: number;
  degree?: number;
}

const Profile: React.FC = () => {
  const [userInfo, setUserInfo] = useState<UserInfo>({})
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const formRef = useRef<any>()

  const fetchUserInfo = async () => {
    setLoading(true)
    try {
      const res = await queryCurrentUser()
      if (res.code === 0 && res.data) {
        setUserInfo(res.data)
        setTimeout(() => {
          formRef.current?.setFieldsValue({
            realName: res.data.realName,
            nickName: res.data.nickName,
            nation: res.data.nation,
            politics: res.data.politics,
            birthday: res.data.birthday,
            gender: res.data.gender,
            degree: res.data.degree,
            avatarUrl: res.data.avatarUrl
              ? [
                {
                  uid: '-1',
                  status: 'done',
                  url: getDocHttpUrl(res.data.avatarUrl),
                },
              ]
              : [],
          })
        }, 200)
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

  const handleCancel = () => {
    setEditing(false)
    fetchUserInfo()
  }

  const handleUpdate = async (values: any) => {
    try {
      const params: any = {
        nickName: values.nickName,
        nation: values.nation,
        politics: values.politics,
        birthday: dayjs(values.birthday).format('YYYY-MM-DD'),
        gender: values.gender,
        degree: values.degree,
      }

      const avatarFileList = formatUploadFile(values.avatarUrl)
      const uploadedAvatar = avatarFileList.find((_) => _.status === 'done')
      if (uploadedAvatar?.url) {
        params.avatarUrl = uploadedAvatar.url
      } else if (values.avatarUrl && values.avatarUrl[0]?.url) {
        params.avatarUrl = userInfo.avatarUrl
      } else {
        params.avatarUrl = ''
      }

      const res = await updateCurrentUser(params)
      if (res.code === 0) {
        successMessage('保存成功')
        setEditing(false)
        fetchUserInfo()
        return true
      } else {
        errorMessage(res.msg || '保存失败')
        return false
      }
    } catch (error) {
      console.error('保存失败', error)
      errorMessage('保存失败，请稍后再试')
      return false
    }
  }

  return (
    <Card title='个人资料' loading={loading}>
      <ProForm
        formRef={formRef}
        submitter={{
          render: (_, dom) => {
            return (
              <Row>
                <Col span={12} offset={4}>
                  {
                    editing ? <Space>
                      <Button type='default' onClick={handleCancel}>取消</Button>
                      <Button type='primary' onClick={async () => {
                        try {
                          await formRef.current?.validateFields()
                          await handleUpdate(formRef.current?.getFieldsFormatValue?.())
                        } catch (e) {
                          console.error(e)
                        }
                      }}>保存</Button>
                    </Space> : <Button type='default' onClick={() => {
                      setEditing(true)
                    }}>编辑</Button>
                  }
                </Col>
              </Row>
            )
          },
        }}
        layout='horizontal'
        labelCol={{span: 4}}
        wrapperCol={{span: 12}}
        readonly={!editing}
      >
        <ProFormUploadButton
          name='avatarUrl'
          label='头像'
          title='选择头像'
          max={1}
          fieldProps={{
            name: 'avatar',
            listType: 'picture-card',
            accept: '.png, .jpg, .jpeg',
            beforeUpload: (file) => {
              const isJpgOrPng = file.type === 'image/jpeg' || file.type === 'image/png'
              if (!isJpgOrPng) {
                errorMessage('仅支持PNG、JPG格式的图片')
              }
              const isLt = file.size / 1024 < 300
              if (!isLt) {
                errorMessage('图片大小不超过300K')
              }
              return (isJpgOrPng && isLt) || Upload.LIST_IGNORE
            },
            headers: {'param-accessToken': getAccessToken()},
            onRemove: () => editing,
          }}
          // @ts-ignore
          action={DOC_API_BASE + '/file/upload/simple'}
          disabled={!editing}
          onChange={({file}) => {
            if (file.response && file.response.code !== 0) {
              errorMessage('上传失败：' + (file.response.msg || '请稍后再试'))
            }
          }}
        />

        <ProFormText
          name='realName'
          label='姓名'
          readonly
          placeholder='-'
        />
        <ProFormText
          name='nickName'
          label='昵称'
        />
        <ProFormText
          name='userCode'
          label='学号/工号'
          readonly
          placeholder='-'
        />
        <ProFormText
          name='orgName'
          label='学院'
          readonly
          placeholder='-'
        />
        <ProFormText
          name='major'
          label='专业'
          readonly
          placeholder='-'
        />
        <ProFormText
          name='grade'
          label='年级'
          readonly
          placeholder='-'
        />
        <ProFormSelect
          name='nation'
          label='民族'
          options={NationEnum.toOptions()}
        />
        <ProFormSelect
          name='politics'
          label='政治面貌'
          options={PoliticsEnum.toOptions()}
        />
        <ProFormDatePicker
          name='birthday'
          label='生日'
          type='date'
        />
        <ProFormSelect
          name='gender'
          label='性别'
          options={GenderEnum.toOptions()}
        />
        <ProFormSelect
          name='degree'
          label='学历'
          options={DegreeEnum.toOptions()}
        />
      </ProForm>
    </Card>
  )
}

export default Profile
