import {GithubOutlined} from '@ant-design/icons'
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
          key: 'fastify',
          title: 'fastify',
          href: 'https://fastify.dev',
          blankTarget: true,
        },
        {
          key: 'github',
          title: <GithubOutlined/>,
          href: 'https://github.com',
          blankTarget: true,
        },
      ]}
    />
  )
}

export default Footer
