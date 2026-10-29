import {getRuntimeFooter} from '@/utils/runtimeBranding'
import {DefaultFooter} from '@ant-design/pro-components'
import React from 'react'
import {useLocation} from '@umijs/max'

export type FooterProps = {
  style?: React.CSSProperties | undefined;
}

const Footer: React.FC<FooterProps> = (props) => {
  const location = useLocation()

  /*进入子应用，不显示父应用的版权信息*/
  if (location.pathname.startsWith('/sub/')) {
    return null
  }

  return (
    <DefaultFooter
      style={{
        background: 'none',
        ...props.style
      }}
      links={[
        {
          key: 'icp',
          title: getRuntimeFooter().icp || 'xxxxxxx',
          href: 'https://beian.miit.gov.cn/',
          blankTarget: true,
        },
      ]}
      copyright={`${new Date().getFullYear()} ${getRuntimeFooter().copyrightHolder || 'xxxx 版权所有'}`}
    />
  )
}

export default Footer
