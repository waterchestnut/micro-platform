import React, {ForwardRefRenderFunction, useEffect, useImperativeHandle, useRef, useState} from 'react'
import {
  ModalForm, ProFormCheckbox,
  ProFormInstance,
} from '@ant-design/pro-components'
import {isArray, waitTime} from '@/utils/util'
import {errorMessage, successMessage} from '@/utils/msg'
import {getClientPrivList, saveGroupPrivs} from '@/services/app/clientPriv'
import {Checkbox, CheckboxChangeEvent, Space} from 'antd'

export type GroupPrivsProps = {
  onSaveFinish?: (resData?: any) => Promise<void>;
  clientCode: string;
  apiRelativeUrls?: any;
};

export type GroupPrivsAction = {
  show: (record?: any) => void;
  close: () => void;
}

const GroupPrivs: ForwardRefRenderFunction<GroupPrivsAction, GroupPrivsProps> = (props, ref) => {
  const {onSaveFinish, clientCode, apiRelativeUrls} = props
  const [isOpen, setIsOpen] = useState(false)
  const [groupInfo, setGroupInfo] = useState<any>(null)
  const formRef = useRef<ProFormInstance>()
  const [modulePrivList, setModulePrivList] = useState<any[]>([])
  const [expendedPrivList, setExpendedPrivList] = useState<any[]>([])
  const [checkedPrivs, setCheckedPrivs] = useState<any>({})

  const loadPrivList = async () => {
    if (!clientCode) {
      setModulePrivList([])
      setExpendedPrivList([])
      return
    }
    let data = await getClientPrivList(clientCode, apiRelativeUrls?.getClientPrivList)
    let list: any[] = []
    data?.forEach((privInfo: any) => {
      let item = list.find(item => item.moduleCode === privInfo.moduleCode)
      if (!item) {
        item = {moduleCode: privInfo.moduleCode, moduleName: privInfo.moduleName, privs: []}
        list.push(item)
      }
      item.privs.push({label: privInfo.modulePrivName, value: privInfo.modulePrivCode})
    })
    setExpendedPrivList(data || [])
    setModulePrivList(list)
  }

  useEffect(() => {
    loadPrivList()
  }, [clientCode])

  const getAllCheckedPrivCodes = () => {
    let privs: any[] = []
    for (let key in checkedPrivs) {
      if (isArray(checkedPrivs[key]) && checkedPrivs[key].length) {
        privs = privs.concat(checkedPrivs[key])
      }
    }
    return privs
  }

  const handleOk = async () => {
    let privs: any[] = getAllCheckedPrivCodes()
    let ret
    let tip
    ret = await saveGroupPrivs(clientCode, groupInfo.groupCode, privs, apiRelativeUrls?.saveGroupPrivs)
    tip = '修改权限'
    if (ret.code !== 0) {
      let msg = ret.msg || tip + '失败，请稍后再试'
      return errorMessage(msg)
    }

    if (onSaveFinish) {
      await onSaveFinish()
    }
    successMessage(tip + '成功')
    setIsOpen(false)
  }

  const handleCancel = () => {
    setIsOpen(false)
  }

  useImperativeHandle(ref, () => ({
    show: async (info: any) => {
      formRef?.current?.resetFields()
      setCheckedPrivs({})
      setGroupInfo(info || null)
      waitTime(200).then(() => {
        if (info) {
          let checked: any = {}
          info.modulePrivCodes?.forEach((code: string) => {
            let privInfo = expendedPrivList.find(item => item.modulePrivCode === code)
            if (privInfo) {
              checked[privInfo.moduleCode] = checked[privInfo.moduleCode] || []
              checked[privInfo.moduleCode].push(code)
            }
          })
          setCheckedPrivs(checked)
          formRef?.current?.setFieldsValue(checked)
        }
      })
      setIsOpen(true)
    },
    close: () => {
      handleCancel()
    }
  }))

  const changeChecked = (changes: any) => {
    setCheckedPrivs({...checkedPrivs, ...changes})
  }

  const onModuleCheckAllChange = (e: CheckboxChangeEvent, moduleCode: string) => {
    /*console.log(e, moduleCode)*/
    if (e.target.checked) {
      let data = {[moduleCode]: modulePrivList.find((_) => _.moduleCode === moduleCode)?.privs?.map((_: any) => _.value)}
      formRef?.current?.setFieldsValue(data)
      changeChecked(data)
    } else {
      formRef?.current?.setFieldsValue({[moduleCode]: []})
      changeChecked({[moduleCode]: []})
    }
  }

  const onAllCheckAllChange = (e: CheckboxChangeEvent) => {
    if (e.target.checked) {
      let data: any = {}
      modulePrivList.forEach((_) => {
        data[_.moduleCode] = _.privs?.map((_: any) => _.value)
      })
      formRef?.current?.setFieldsValue(data)
      changeChecked(data)
    } else {
      formRef?.current?.resetFields()
      setCheckedPrivs({})
    }
  }

  return (
    <ModalForm
      title={`${groupInfo?.groupName}角色赋权`}
      open={isOpen}
      layout={'vertical'}
      formRef={formRef}
      modalProps={
        {
          onCancel: handleCancel,
          centered: true,
          destroyOnClose: true
        }
      }
      onFinish={async () => {
        await handleOk()
      }}
      onValuesChange={(changes: Array<any>) => {
        changeChecked(changes)
      }}
      submitter={{
        render: (props, doms) => {
          //console.log(props)
          return (
            <Space>
              <Checkbox
                indeterminate={getAllCheckedPrivCodes().length > 0 && getAllCheckedPrivCodes().length < expendedPrivList.length}
                onChange={(e) => {
                  onAllCheckAllChange(e)
                }}
                checked={getAllCheckedPrivCodes().length === expendedPrivList.length}
              >全选/反选</Checkbox>
              {doms}
            </Space>
          )
        },
      }}
    >
      {
        modulePrivList.map((item) => (
          <ProFormCheckbox.Group
            key={item.moduleCode}
            name={item.moduleCode}
            label={<span style={{fontWeight: 600}}>{item.moduleName}(<Checkbox
              style={{marginLeft: '8px'}}
              indeterminate={checkedPrivs?.[item.moduleCode]?.length > 0 && checkedPrivs?.[item.moduleCode]?.length < item.privs.length}
              onChange={(e) => {
                onModuleCheckAllChange(e, item.moduleCode)
              }}
              checked={checkedPrivs?.[item.moduleCode]?.length === item.privs.length}>全选/反选</Checkbox>)</span>}
            options={item.privs}
          />
        ))
      }
    </ModalForm>
  )
}

export default React.forwardRef(GroupPrivs)
