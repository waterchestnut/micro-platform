import {GithubOutlined} from '@ant-design/icons';
import {DefaultFooter} from '@ant-design/pro-components';
import React from 'react';

export type FooterProps = {
  style?: React.CSSProperties | undefined;
}

const Footer: React.FC<FooterProps> = (props) => {
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
  );
};

export default Footer;
