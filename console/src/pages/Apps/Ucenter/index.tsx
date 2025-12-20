import {useModel, history} from '@umijs/max';
import {theme} from 'antd';
import React from 'react';
import WujieReact from 'wujie-react';
import {getCommonProps} from "@/utils/wujie";

const Ucenter: React.FC = () => {
  const {token} = theme.useToken();
  const {initialState} = useModel('@@initialState');
  const props = getCommonProps();
  return (
    // 保活模式，name相同则复用一个子应用实例，改变url无效，必须采用通信的方式告知路由变化
    <WujieReact
      width="100%"
      height="100%"
      name="ucenter"
      // @ts-ignore
      url={UCENTER_PLATFORM_BASE}
      sync={false}
      props={props}
    ></WujieReact>
  );
};

export default Ucenter;
