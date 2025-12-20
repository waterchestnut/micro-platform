declare namespace STATISTICAPI {
  type fullDefinitionModels = {
    /** Operator */
    Operator?: { userCode?: string; realName?: string; orgCode?: string };
    /** Tag */
    Tag?: { key?: string; value?: string };
  };

  type fullEnumModels = {
    /** StatusEnum */
    StatusEnum?: { deleted?: number; normal?: number; disabled?: number };
  };

  type fullParamModels = {
    /** MsgInfo */
    MsgInfo?: {
      msgCode: string;
      operateType?: string;
      title?: string;
      sysCode?: string;
      sysName?: string;
      clientCode?: string;
      clientName?: string;
      browseTime?: number;
      content?: Record<string, any>;
      operator?: { userCode?: string; realName?: string; orgCode?: string };
      status?: -1 | 0 | 1;
      tags?: { key?: string; value?: string }[];
    };
  };

  type fullStoreModels = {
    /** MsgInfo */
    MsgInfo?: {
      msgCode: string;
      operateType?: string;
      title?: string;
      sysCode?: string;
      sysName?: string;
      clientCode?: string;
      clientName?: string;
      browseTime?: number;
      content?: Record<string, any>;
      operator?: { userCode?: string; realName?: string; orgCode?: string; _id?: string };
      status?: -1 | 0 | 1;
      tags?: { key?: string; value?: string; _id?: string }[];
      insertTime?: string;
      updateTime?: string;
      _id?: string;
    };
  };

  type MsgInfo = {
    /** 统计消息标识 */
    msgCode: string;
    /** 操作类型 */
    operateType?: string;
    /** 消息标题 */
    title?: string;
    /** 日志发生的系统标识 */
    sysCode?: string;
    /** 日志发生的系统名称 */
    sysName?: string;
    /** 第三方应用标识 */
    clientCode?: string;
    /** 第三方应用名称 */
    clientName?: string;
    /** 日期记录的时间戳 */
    browseTime?: number;
    /** 详细的日志信息 */
    content?: Record<string, any>;
    /** 操作者 */
    operator?: { userCode?: string; realName?: string; orgCode?: string };
    /** 状态 */
    status?: -1 | 0 | 1;
    /** 标签 */
    tags?: { key?: string; value?: string }[];
  };
}
