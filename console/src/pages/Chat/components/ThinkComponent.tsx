import {Think} from '@ant-design/x'
import XMarkdown, {type ComponentProps} from '@ant-design/x-markdown'
import React from 'react'

const ThinkComponent = React.memo((props: ComponentProps) => {
  const [title, setTitle] = React.useState('思考中...')
  const [loading, setLoading] = React.useState(true)
  const [expand, setExpand] = React.useState(true)

  React.useEffect(() => {
    if (props.streamStatus === 'done') {
      setTitle('思考完成')
      setLoading(false)
      setExpand(false)
    }
  }, [props.streamStatus])

  return (
    <Think title={title} loading={loading} expanded={expand} onClick={() => setExpand(!expand)}>
      {props.children}
    </Think>
  )
})

export default ThinkComponent
