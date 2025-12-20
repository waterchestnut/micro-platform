import {ProTable} from '@ant-design/pro-components';
import type {ProTableProps} from '@ant-design/pro-components';
import {createStyles} from "antd-style";
import React from "react";
import {useRouteData} from '@umijs/max';
// @ts-ignore
import type {ParamsType} from "@ant-design/pro-provider";
import {getEmbeddedName} from "@/utils/embed";

const useStyles = createStyles(({token}) => {
  return {
    container: {
      backgroundColor: token.colorBgLayout,
    },
  };
});

const ProTableWrapper = <DataType extends Record<string, any>, Params extends ParamsType = ParamsType, ValueType = "text">(props: ProTableProps<DataType, Params, ValueType>) => {
  const {styles} = useStyles();
  const pagination = Object.assign({showSizeChanger: true, showQuickJumper: true}, props.pagination);
  const sticky = typeof props.sticky !== "undefined" ? props.sticky : false;
  const routeData = useRouteData();
  const appName = getEmbeddedName();
  /*console.log(routeData)*/
  return <div className={styles.container}>
    <ProTable<DataType, Params, ValueType>
      columnsState={{
        persistenceKey: `${appName ? (appName + '-') : ''}${routeData.route.path}`,
        persistenceType: 'localStorage'
      }}
      scroll={{x: 'max-content'}}
      search={{
        filterType: "query",
        labelWidth: 'auto',
      }}
      tableAlertRender={false}
      beforeSearchSubmit={params => {
        for (let key in params) {
          if (params[key] === '') {
            delete params[key];
          }
        }
        return params;
      }}
      {...props}
      pagination={pagination}
      sticky={sticky}
    />
  </div>
}

export default ProTableWrapper;
