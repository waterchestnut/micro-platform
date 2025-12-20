import React, {useContext, useEffect, useMemo, useState} from 'react'
import VanillaJSONEditor from '@/components/VanillaJSONEditor'
import {EditableProTable, ProCard, ProColumns} from '@ant-design/pro-components'
import {type Content, createAjvValidator} from 'vanilla-jsoneditor'
import {Button, Popconfirm, Space, Typography} from 'antd'
import {getClientPageConfigList, saveClientPageConfig} from '@/services/app/clientPageConfig'
import {getClientPrivList} from '@/services/app/clientPriv'
import {
  DndContext, DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable'
import {CSS} from '@dnd-kit/utilities'
import {SyntheticListenerMap} from '@dnd-kit/core/dist/hooks/utilities'
import {HolderOutlined} from '@ant-design/icons'
import {restrictToVerticalAxis} from '@dnd-kit/modifiers'
import {errorMessage, successMessage} from '@/utils/msg'
import {createStyles} from 'antd-style'
import EndpointTypeEnum from '@/enum/EndpointTypeEnum'

const useStyles = createStyles(({token}) => {
  return {
    formEditWrapper: {
      margin: '-16px -24px'
    },
  }
})

export type ApiManageProps = {
  pClientInfo?: any;
  apiRelativeUrls?: any;
};


interface RowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  'data-row-key': string;
}

interface RowContextProps {
  setActivatorNodeRef?: (element: HTMLElement | null) => void;
  listeners?: SyntheticListenerMap;
}

const RowContext = React.createContext<RowContextProps>({})

const DragHandle: React.FC = () => {
  const {setActivatorNodeRef, listeners} = useContext(RowContext)
  return (
    <Button
      type='text'
      size='small'
      icon={<HolderOutlined/>}
      style={{cursor: 'move'}}
      ref={setActivatorNodeRef}
      {...listeners}
    />
  )
}

const CusRow: React.FC<RowProps> = (props) => {
  const {attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging} = useSortable({
    id: props['data-row-key'],
  })

  const style: React.CSSProperties = {
    ...props.style,
    transform: CSS.Translate.toString(transform),
    transition,
    ...(isDragging ? {position: 'relative', zIndex: 9999} : {}),
  }

  const contextValue = useMemo<RowContextProps>(() => ({setActivatorNodeRef, listeners}), [
    setActivatorNodeRef,
    listeners,
  ])

  return (
    <RowContext.Provider value={contextValue}>
      <tr {...props} ref={setNodeRef} style={style} {...attributes} />
    </RowContext.Provider>
  )
}

const schema = {
  title: '路由列表',
  type: 'array',
  description: '本应用全部的路由授权要求',
  items: {
    title: '单个路由项',
    type: 'object',
    required: ['name', 'path'],
    properties: {
      name: {
        title: '路由显示名称',
        type: 'string',
      },
      path: {
        title: '路径',
        type: 'string',
        description: '支持find-my-way的写法：https://github.com/delvedor/find-my-way',
        examples: ['/core/user/cur', '/core/user/auth/*', '/core/user/auth/*', '/core/captcha*']
      },
      auth: {
        title: '是否设置用户授权后才能访问',
        type: 'boolean',
        description: '开启后，只有给用户分配了privs中的权限才能调用该接口',
        default: false
      },
      privs: {
        title: '要求给用户分配的权限列表',
        type: 'array',
        description: '要求给用户分配的权限列表，配合开启auth使用',
        default: ['all'],
        items: {
          title: '单个权限项',
          type: 'string',
          description: '权限管理中定义的权限标识，all代表用户只要登录即可访问',
        }
      },
      clientAuth: {
        title: '是否设置应用授权后才能访问',
        type: 'boolean',
        description: '开启后，只有给应用分配了clientPrivs中的权限才能调用该接口',
        default: false
      },
      clientPrivs: {
        title: '要求给应用分配的权限列表',
        type: 'array',
        description: '要求给应用分配的权限列表，配合开启clientAuth使用',
        default: ['all'],
        items: {
          title: '单个权限项',
          type: 'string',
          description: '权限管理中定义的权限标识，all代表应用只有验证秘钥通过即可访问',
        }
      }
    }
  }
}

const example = [
  {
    'name': '获取当前登录用户信息',
    'path': '/core/user/cur',
    'auth': true,
    'privs': [
      'all'
    ],
    'clientAuth': false,
    'clientPrivs': []
  }
]

const ApiManage: React.FC<ApiManageProps> = (props) => {
  const {pClientInfo, apiRelativeUrls} = props
  const [tab, setTab] = useState('json')
  const [content, setContent] = useState<Content | any>({
    json: [],
    text: undefined,
  })
  const [privs, setPrivs] = useState([])
  const [editableKeys, setEditableRowKeys] = useState<React.Key[]>([])
  const {styles} = useStyles()

  const loadConfigs = async () => {
    if (pClientInfo?.clientCode) {
      let data = await getClientPageConfigList(pClientInfo.clientCode, apiRelativeUrls?.getClientPageConfigList)
      setContent({
        json: data,
        text: undefined,
      })
      let list = ((await getClientPrivList(pClientInfo.clientCode, apiRelativeUrls?.getClientPrivList)) || []).map((_: any) => ({
        label: _.modulePrivName,
        value: _.modulePrivCode
      }))
      list.unshift({label: '仅登录即可', value: 'all'})
      setPrivs(list)
    } else {
      setContent({
        json: [],
        text: undefined,
      })
      setPrivs([])
    }
  }

  useEffect(() => {
    loadConfigs()
  }, [pClientInfo])

  const columns: ProColumns[] = [
    {
      title: '名称',
      dataIndex: 'name',
    },
    {
      title: '路由',
      dataIndex: 'path',
    },
    {
      title: '要求用户授权',
      dataIndex: 'auth',
      valueType: 'switch',
    },
    {
      title: '要求的用户权限列表',
      dataIndex: 'privs',
      valueType: 'select',
      fieldProps: {options: privs, mode: 'multiple'},
      render: (text, record) => {
        if (record.privs?.length > 0) {
          return text
        }
        return '-'
      }
    },
    {
      title: '要求应用授权',
      dataIndex: 'clientAuth',
      valueType: 'switch',
    },
    {
      title: '要求的应用权限列表',
      dataIndex: 'clientPrivs',
      valueType: 'select',
      fieldProps: {options: privs, mode: 'multiple'},
      render: (text, record) => {
        if (record.clientPrivs?.length > 0) {
          return text
        }
        return '-'
      }
    },
    {
      title: '操作',
      valueType: 'option',
      width: 180,
      render: (text, record, _, action) => [
        <a
          key='editable'
          onClick={() => {
            action?.startEditable?.(record.path)
          }}
        >
          编辑
        </a>,
        <a
          key='delete'
          onClick={() => {
            setContent({json: content.json.filter((item: any) => item.path !== record.path)})
          }}
        >
          删除
        </a>,
        <DragHandle
          key='sort'/>
      ],
    },
  ]

  const onDragEnd = ({active, over}: DragEndEvent) => {
    if (over && active.id !== over?.id) {
      const oldIndex = content.json.findIndex((item: any) => item.path === active.id)
      const newIndex = content.json.findIndex((item: any) => item.path === over.id)
      const newData = arrayMove(content.json, oldIndex, newIndex)
      setContent({
        json: newData,
        text: undefined,
      })
    }
  }

  const handleOk = async () => {
    let ret = await saveClientPageConfig(pClientInfo.clientCode, content.json, apiRelativeUrls?.saveClientPageConfig)
    if (ret.code !== 0) {
      let msg = ret.msg || '保存失败，请稍后再试'
      return errorMessage(msg)
    }

    successMessage('保存成功')
    loadConfigs()
  }

  return (
    <ProCard
      title='编辑完成后，需要点击“保存”按钮整体保存'
      extra={<Space>
        <Button type='primary' onClick={handleOk}>保存</Button>
        <Popconfirm
          title='重新加载后未保存的修改将会丢失，确定要重新加载吗？'
          onConfirm={async () => {
            loadConfigs()
          }}
          okText='确定'
          cancelText='取消'
          key='delete'
        >
          <Button danger>重新加载</Button>
        </Popconfirm>
      </Space>}
      tabs={{
        activeKey: tab,
        items: [
          {
            label: `JSON编辑`,
            key: 'json',
            children: <>
              <VanillaJSONEditor
                content={content}
                onChange={(updatedContent: any, previousContent: any, {contentErrors, patchResult}: any) => {
                  /*console.log(updatedContent, previousContent, contentErrors, patchResult)*/
                  let con = updatedContent
                  if (!updatedContent.json && updatedContent.text && !contentErrors) {
                    con.json = JSON.parse(updatedContent.text)
                    delete con.text
                  }
                  setContent(con)
                }}
                validator={createAjvValidator({schema})}
              />
              <Typography.Paragraph></Typography.Paragraph>
              <Typography.Title level={5}>配置示例：</Typography.Title>
              <Typography.Paragraph>
                <pre>
                  <code>{JSON.stringify(example, null, 2)}</code>
                </pre>
              </Typography.Paragraph>
              <Typography.Title level={5}>配置说明：</Typography.Title>
              <Typography.Paragraph>
                <pre>
                  <code>{JSON.stringify(schema, null, 2)}</code>
                </pre>
              </Typography.Paragraph>
            </>,
          },
          {
            label: `表单编辑`,
            key: 'form',
            children: <div className={styles.formEditWrapper}>
              <DndContext onDragEnd={onDragEnd} modifiers={[restrictToVerticalAxis]}>
                <SortableContext
                  items={(content?.json || []).map((item: any) => item.path)}
                  strategy={verticalListSortingStrategy}
                >
                  <EditableProTable
                    headerTitle='可拖拽排序'
                    columns={columns}
                    rowKey='path'
                    search={false}
                    pagination={false}
                    value={content?.json || []}
                    onChange={(data) => {
                      data.forEach((item: any) => {
                        delete item.index
                      })
                      setContent({json: data, text: undefined})
                    }}
                    editable={{
                      type: 'multiple',
                      editableKeys,
                      onChange: setEditableRowKeys,
                    }}
                    recordCreatorProps={{
                      position: 'bottom',//position为top时，EditableProTable重写了components，只返回header，会导致设置的排序失效
                      record: () => ({
                        'path': `/${Date.now()}/`,
                        'name': `route-${Date.now()}`,
                        'auth': true,
                        'privs': [
                          'all'
                        ],
                        'clientAuth': false,
                        'clientPrivs': []
                      }),
                      creatorButtonText: '添加一条路由',
                    }}
                    components={{
                      body: {
                        row: CusRow,
                      },
                    }}
                  />
                </SortableContext>
              </DndContext>
            </div>,
          },
        ],
        onChange: (key) => {
          setTab(key)
        },
      }}
    />
  )
}

export default ApiManage
