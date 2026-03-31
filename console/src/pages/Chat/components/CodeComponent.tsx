import {Bubble, CodeHighlighter} from '@ant-design/x'
import XMarkdown, {type ComponentProps} from '@ant-design/x-markdown'
import React from 'react'

const Code: React.FC<ComponentProps> = (props) => {
  const {className, children} = props
  const lang = className?.match(/language-(\w+)/)?.[1] || ''

  if (typeof children !== 'string') return null
  return <CodeHighlighter lang={lang}>{children}</CodeHighlighter>
}

export default Code
