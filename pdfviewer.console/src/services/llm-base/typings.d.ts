declare namespace LLMAPI {
  type AgentLog = {
    /** 日志标识 */
    logCode: string;
    /** 智能体标识 */
    agentCode?: string;
    /** 智能体标识路径 */
    agentCodePath?: string[];
    /** 日志分组 */
    group?: string;
    /** 日志内容 */
    content?: string;
    /** 创建者 */
    operator?: Record<string, any>;
    /** 状态 */
    status?: -1 | 0 | 1;
    /** 标签 */
    tags?: { key?: string; value?: string }[];
    /** 日志的扩展信息 */
    extInfo?: Record<string, any>;
  };

  type AgentTask = {
    /** 智能体标识 */
    agentCode: string;
    /** 智能体标题 */
    title?: string;
    /** 智能体类型 */
    agentType?: 'sequential' | 'parallel' | 'dynamic' | 'local' | 'grpc' | 'llm';
    /** 父级智能体标识 */
    parentCode?: string;
    /** 下一个要执行的智能体标识 */
    nextAgentCode?: string;
    /** 子智能体 */
    subAgents?: { agentCode?: string; handleStatus?: -1 | 0 | 1 | 2 | 3 }[];
    /** 智能体标识路径 */
    agentCodePath?: string[];
    /** 执行状态 */
    handleStatus?: -1 | 0 | 1 | 2 | 3;
    /** 执行返回值 */
    handleRet?: Record<string, any>;
    /** 向父级智能体传递执行结果的键值 */
    toParentOutputKey?: string;
    /** 智能体处理器 */
    handler?: string;
    /** 初始参数 */
    params?: Record<string, any>;
    /** 处理错误的模式 */
    errorMode?: 'break' | 'continue';
    /** 执行模式 */
    handleMode?: 'queue' | 'manual';
    /** 创建者 */
    operator?: Record<string, any>;
    /** 状态 */
    status?: -1 | 0 | 1;
    /** 标签 */
    tags?: { key?: string; value?: string }[];
  };

  type AnswerCache = {
    /** 缓存标识 */
    answerCacheCode: string;
    /** 来源会话标识 */
    sourceConversationCode?: string;
    /** 来源消息标识 */
    sourceMessageCode?: string;
    /** 会话所属频道 */
    channel?: string;
    /** 频道内附加的缓存标识 */
    channelCacheKey?: string;
    /** 大模型配置节点 */
    llmModel?: string;
    /** 用户问题 */
    query?: string;
    /** 用户问题的Hash值 */
    queryHashCode?: string;
    /** 大模型的输出内容 */
    answer?: string;
    /** 输出Token数量 */
    answerTokens?: number;
    /** 大模型思考过程 */
    answerReasoning?: string;
    /** 操作人 */
    operator?: Record<string, any>;
    /** 状态 */
    status?: -1 | 0 | 1;
    /** 标签 */
    tags?: { key?: string; value?: string }[];
  };

  type Conversation = {
    /** 会话标识 */
    conversationCode: string;
    /** 会话标题 */
    title?: string;
    /** 会话所属频道 */
    channel?: string;
    /** 会话在频道内的分组 */
    channelGroup?: string;
    /** 会话类型 */
    conversationType?: 'chat' | 'agentTask';
    /** 大模型配置节点 */
    llmModel?: string;
    /** 会话所属人 */
    operator?: Record<string, any>;
    /** 状态 */
    status?: -1 | 0 | 1;
    /** 标签 */
    tags?: { key?: string; value?: string }[];
  };

  type fullDefinitionModels = {
    /** SubAgent */
    SubAgent?: { agentCode?: string; handleStatus?: -1 | 0 | 1 | 2 | 3 };
    /** Tag */
    Tag?: { key?: string; value?: string };
  };

  type fullEnumModels = {
    /** AgentErrorModeEnum */
    AgentErrorModeEnum?: { break?: string; continue?: string };
    /** AgentHandleModeEnum */
    AgentHandleModeEnum?: { queue?: string; manual?: string };
    /** AgentHandleStatusEnum */
    AgentHandleStatusEnum?: {
      error?: number;
      waiting?: number;
      handling?: number;
      success?: number;
      completed?: number;
    };
    /** AgentTypeEnum */
    AgentTypeEnum?: {
      sequential?: string;
      parallel?: string;
      dynamic?: string;
      local?: string;
      grpc?: string;
      llm?: string;
    };
    /** ConversationTypeEnum */
    ConversationTypeEnum?: { chat?: string; agentTask?: string };
    /** MessageProgressEnum */
    MessageProgressEnum?: {
      waiting?: string;
      processing?: string;
      finish?: string;
      error?: string;
    };
    /** StatusEnum */
    StatusEnum?: { deleted?: number; normal?: number; disabled?: number };
  };

  type fullParamModels = {
    /** AgentLog */
    AgentLog?: {
      logCode: string;
      agentCode?: string;
      agentCodePath?: string[];
      group?: string;
      content?: string;
      operator?: Record<string, any>;
      status?: -1 | 0 | 1;
      tags?: { key?: string; value?: string }[];
      extInfo?: Record<string, any>;
    };
    /** AgentTask */
    AgentTask?: {
      agentCode: string;
      title?: string;
      agentType?: 'sequential' | 'parallel' | 'dynamic' | 'local' | 'grpc' | 'llm';
      parentCode?: string;
      nextAgentCode?: string;
      subAgents?: { agentCode?: string; handleStatus?: -1 | 0 | 1 | 2 | 3 }[];
      agentCodePath?: string[];
      handleStatus?: -1 | 0 | 1 | 2 | 3;
      handleRet?: Record<string, any>;
      toParentOutputKey?: string;
      handler?: string;
      params?: Record<string, any>;
      errorMode?: 'break' | 'continue';
      handleMode?: 'queue' | 'manual';
      operator?: Record<string, any>;
      status?: -1 | 0 | 1;
      tags?: { key?: string; value?: string }[];
    };
    /** AnswerCache */
    AnswerCache?: {
      answerCacheCode: string;
      sourceConversationCode?: string;
      sourceMessageCode?: string;
      channel?: string;
      channelCacheKey?: string;
      llmModel?: string;
      query?: string;
      queryHashCode?: string;
      answer?: string;
      answerTokens?: number;
      answerReasoning?: string;
      operator?: Record<string, any>;
      status?: -1 | 0 | 1;
      tags?: { key?: string; value?: string }[];
    };
    /** Conversation */
    Conversation?: {
      conversationCode: string;
      title?: string;
      channel?: string;
      channelGroup?: string;
      conversationType?: 'chat' | 'agentTask';
      llmModel?: string;
      operator?: Record<string, any>;
      status?: -1 | 0 | 1;
      tags?: { key?: string; value?: string }[];
    };
    /** Message */
    Message?: {
      messageCode: string;
      conversationCode?: string;
      channel?: string;
      channelGroup?: string;
      llmModel?: string;
      llmParams?: Record<string, any>;
      ragParams?: Record<string, any>;
      query?: string;
      inputs?: Record<string, any>[];
      messages?: Record<string, any>[];
      messageTokens?: number;
      messagePriceUnit?: number;
      answer?: string;
      answerTokens?: number;
      answerPriceUnit?: number;
      answerReasoning?: string;
      answerFromCache?: boolean;
      answerCacheCode?: string;
      answerFeedback?: number;
      totalPrice?: number;
      progress?: 'waiting' | 'processing' | 'finish' | 'error';
      error?: string;
      operator?: Record<string, any>;
      status?: -1 | 0 | 1;
      tags?: { key?: string; value?: string }[];
      extInfo?: Record<string, any>;
    };
  };

  type fullStoreModels = {
    /** AgentLog */
    AgentLog?: {
      logCode: string;
      agentCode?: string;
      agentCodePath?: string[];
      group?: string;
      content?: string;
      operator?: Record<string, any>;
      status?: -1 | 0 | 1;
      tags?: { key?: string; value?: string; _id?: string }[];
      extInfo?: Record<string, any>;
      insertTime?: string;
      updateTime?: string;
      _id?: string;
    };
    /** AgentTask */
    AgentTask?: {
      agentCode: string;
      title?: string;
      agentType?: 'sequential' | 'parallel' | 'dynamic' | 'local' | 'grpc' | 'llm';
      parentCode?: string;
      nextAgentCode?: string;
      subAgents?: { agentCode?: string; handleStatus?: -1 | 0 | 1 | 2 | 3; _id?: string }[];
      agentCodePath?: string[];
      handleStatus?: -1 | 0 | 1 | 2 | 3;
      handleRet?: Record<string, any>;
      toParentOutputKey?: string;
      handler?: string;
      params?: Record<string, any>;
      errorMode?: 'break' | 'continue';
      handleMode?: 'queue' | 'manual';
      operator?: Record<string, any>;
      status?: -1 | 0 | 1;
      tags?: { key?: string; value?: string; _id?: string }[];
      insertTime?: string;
      updateTime?: string;
      _id?: string;
    };
    /** AnswerCache */
    AnswerCache?: {
      answerCacheCode: string;
      sourceConversationCode?: string;
      sourceMessageCode?: string;
      channel?: string;
      channelCacheKey?: string;
      llmModel?: string;
      query?: string;
      queryHashCode?: string;
      answer?: string;
      answerTokens?: number;
      answerReasoning?: string;
      operator?: Record<string, any>;
      status?: -1 | 0 | 1;
      tags?: { key?: string; value?: string; _id?: string }[];
      insertTime?: string;
      updateTime?: string;
      _id?: string;
    };
    /** Conversation */
    Conversation?: {
      conversationCode: string;
      title?: string;
      channel?: string;
      channelGroup?: string;
      conversationType?: 'chat' | 'agentTask';
      llmModel?: string;
      operator?: Record<string, any>;
      status?: -1 | 0 | 1;
      tags?: { key?: string; value?: string; _id?: string }[];
      insertTime?: string;
      updateTime?: string;
      _id?: string;
    };
    /** Message */
    Message?: {
      messageCode: string;
      conversationCode?: string;
      channel?: string;
      channelGroup?: string;
      llmModel?: string;
      llmParams?: Record<string, any>;
      ragParams?: Record<string, any>;
      query?: string;
      inputs?: Record<string, any>[];
      messages?: Record<string, any>[];
      messageTokens?: number;
      messagePriceUnit?: number;
      answer?: string;
      answerTokens?: number;
      answerPriceUnit?: number;
      answerReasoning?: string;
      answerFromCache?: boolean;
      answerCacheCode?: string;
      answerFeedback?: number;
      totalPrice?: number;
      progress?: 'waiting' | 'processing' | 'finish' | 'error';
      error?: string;
      operator?: Record<string, any>;
      status?: -1 | 0 | 1;
      tags?: { key?: string; value?: string; _id?: string }[];
      extInfo?: Record<string, any>;
      insertTime?: string;
      updateTime?: string;
      _id?: string;
    };
  };

  type Message = {
    /** 消息标识 */
    messageCode: string;
    /** 会话标识 */
    conversationCode?: string;
    /** 会话所属频道 */
    channel?: string;
    /** 会话在频道内的分组 */
    channelGroup?: string;
    /** 大模型配置节点 */
    llmModel?: string;
    /** 大模型自定义参数 */
    llmParams?: Record<string, any>;
    /** 知识库自定义参数 */
    ragParams?: Record<string, any>;
    /** 用户问题 */
    query?: string;
    /** 格式化的输入内容 */
    inputs?: Record<string, any>[];
    /** 大模型的输入消息列表 */
    messages?: Record<string, any>[];
    /** 输入Token数量 */
    messageTokens?: number;
    /** 输入Token单价 */
    messagePriceUnit?: number;
    /** 大模型的输出内容 */
    answer?: string;
    /** 输出Token数量 */
    answerTokens?: number;
    /** 输出Token单价 */
    answerPriceUnit?: number;
    /** 大模型思考过程 */
    answerReasoning?: string;
    /** 回答内容是否从缓存中读取的 */
    answerFromCache?: boolean;
    /** 缓存标识 */
    answerCacheCode?: string;
    /** 用户对回答的反馈 */
    answerFeedback?: number;
    /** 本次消息的总花销 */
    totalPrice?: number;
    /** 消息进度 */
    progress?: 'waiting' | 'processing' | 'finish' | 'error';
    /** 出错信息 */
    error?: string;
    /** 会话所属人 */
    operator?: Record<string, any>;
    /** 状态 */
    status?: -1 | 0 | 1;
    /** 标签 */
    tags?: { key?: string; value?: string }[];
    /** 消息的扩展信息 */
    extInfo?: Record<string, any>;
  };
}
