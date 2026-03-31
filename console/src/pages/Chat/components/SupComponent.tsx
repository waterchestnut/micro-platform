import {Bubble, Sources} from '@ant-design/x'
import XMarkdown, {type ComponentProps} from '@ant-design/x-markdown'
import React from 'react'
import {SourcesItem} from '@ant-design/x/lib/sources/Sources'

export function getSupComponent(items: SourcesItem[]) {
  return React.memo((props: ComponentProps) => {

    return (
      <Sources
        activeKey={parseInt(`${props?.children}` || '0', 10)}
        title={props.children}
        items={items}
        inline={true}
      />
    )
  })
}
