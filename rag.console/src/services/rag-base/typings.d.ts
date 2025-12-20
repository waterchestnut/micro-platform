declare namespace RAGAPI {
  type fullDefinitionModels = {
    /** MaterialDetail */
    MaterialDetail?: {
      text?: string;
      wordCount?: number;
      tokens?: number;
      language?: string;
      isOriginal?: number;
    };
    /** Operator */
    Operator?: { userCode?: string; realName?: string };
    /** Tag */
    Tag?: { key?: string; value?: string };
  };

  type fullEnumModels = {
    /** RagPermissionEnum */
    RagPermissionEnum?: {
      union?: string;
      onlyMe?: string;
      platform?: string;
      departmentDirect?: string;
      departmentALL?: string;
    };
    /** RagTypeEnum */
    RagTypeEnum?: { builtIn?: string; dify?: string; self?: string };
    /** StatusEnum */
    StatusEnum?: { deleted?: number; normal?: number; disabled?: number };
    /** UsageEnum */
    UsageEnum?: {
      wait?: number;
      used?: number;
      waitText?: number;
      waitTrans?: number;
      waitDocxText?: number;
      waitDocxChunk?: number;
      error?: number;
      errorTrans?: number;
      errorOver?: number;
    };
  };

  type fullParamModels = {
    /** RagChunk */
    RagChunk?: {
      ragChunkCode: string;
      ragCode?: string;
      ragMaterialCode?: string;
      ragSegmentCode?: string;
      content?: string;
      position?: number;
      wordCount?: number;
      language?: string;
      operator?: { userCode?: string; realName?: string };
      status?: -1 | 0 | 1;
      tags?: { key?: string; value?: string }[];
      usage?: 0 | 1 | 2 | 3 | 4 | 5 | -1 | -2 | -3;
    };
    /** RagInfo */
    RagInfo?: {
      ragCode: string;
      title?: string;
      description?: string;
      ragType?: 'builtIn' | 'dify' | 'self';
      metas?: Record<string, any>;
      operator?: Record<string, any>;
      status?: -1 | 0 | 1;
      tags?: { key?: string; value?: string }[];
      embeddingModelProvider?: string;
      embeddingModelId?: string;
      permission?: 'union' | 'onlyMe' | 'platform' | 'departmentDirect' | 'departmentALL';
    };
    /** RagMaterial */
    RagMaterial?: {
      ragMaterialCode: string;
      ragType?: 'builtIn' | 'dify' | 'self';
      physicalPath?: string;
      format?: string;
      details?: {
        text?: string;
        wordCount?: number;
        tokens?: number;
        language?: string;
        isOriginal?: number;
      }[];
      metas?: Record<string, any>;
      ragCode?: string;
      usage?: 0 | 1 | 2 | 3 | 4 | 5 | -1 | -2 | -3;
      operator?: { userCode?: string; realName?: string };
      status?: -1 | 0 | 1;
      tags?: { key?: string; value?: string }[];
      resCode?: string;
      resTitle?: string;
      resOriginalUrl?: string;
      description?: string;
    };
    /** RagSegment */
    RagSegment?: {
      ragSegmentCode: string;
      ragCode?: string;
      ragMaterialCode?: string;
      content?: string;
      position?: number;
      wordCount?: number;
      tokens?: number;
      language?: string;
      operator?: { userCode?: string; realName?: string };
      status?: -1 | 0 | 1;
      tags?: { key?: string; value?: string }[];
      usage?: 0 | 1 | 2 | 3 | 4 | 5 | -1 | -2 | -3;
    };
    /** RagSearchItem 知识库召回片段的详情 */
    RagSearchItem?: {
      ragCode?: string;
      ragMaterialCode?: string;
      ragSegmentCode?: string;
      content?: string;
      resCode?: string;
      resTitle?: string;
      resOriginalUrl?: string;
    };
  };

  type fullStoreModels = {
    /** RagChunk */
    RagChunk?: {
      ragChunkCode: string;
      ragCode?: string;
      ragMaterialCode?: string;
      ragSegmentCode?: string;
      content?: string;
      position?: number;
      wordCount?: number;
      language?: string;
      operator?: { userCode?: string; realName?: string; _id?: string };
      status?: -1 | 0 | 1;
      tags?: { key?: string; value?: string; _id?: string }[];
      usage?: 0 | 1 | 2 | 3 | 4 | 5 | -1 | -2 | -3;
      insertTime?: string;
      updateTime?: string;
      _id?: string;
    };
    /** RagInfo */
    RagInfo?: {
      ragCode: string;
      title?: string;
      description?: string;
      ragType?: 'builtIn' | 'dify' | 'self';
      metas?: Record<string, any>;
      operator?: Record<string, any>;
      status?: -1 | 0 | 1;
      tags?: { key?: string; value?: string; _id?: string }[];
      embeddingModelProvider?: string;
      embeddingModelId?: string;
      permission?: 'union' | 'onlyMe' | 'platform' | 'departmentDirect' | 'departmentALL';
      insertTime?: string;
      updateTime?: string;
      _id?: string;
    };
    /** RagMaterial */
    RagMaterial?: {
      ragMaterialCode: string;
      ragType?: 'builtIn' | 'dify' | 'self';
      physicalPath?: string;
      format?: string;
      details?: {
        text?: string;
        wordCount?: number;
        tokens?: number;
        language?: string;
        isOriginal?: number;
        _id?: string;
      }[];
      metas?: Record<string, any>;
      ragCode?: string;
      usage?: 0 | 1 | 2 | 3 | 4 | 5 | -1 | -2 | -3;
      operator?: { userCode?: string; realName?: string; _id?: string };
      status?: -1 | 0 | 1;
      tags?: { key?: string; value?: string; _id?: string }[];
      resCode?: string;
      resTitle?: string;
      resOriginalUrl?: string;
      description?: string;
      insertTime?: string;
      updateTime?: string;
      _id?: string;
    };
    /** RagSegment */
    RagSegment?: {
      ragSegmentCode: string;
      ragCode?: string;
      ragMaterialCode?: string;
      content?: string;
      position?: number;
      wordCount?: number;
      tokens?: number;
      language?: string;
      operator?: { userCode?: string; realName?: string; _id?: string };
      status?: -1 | 0 | 1;
      tags?: { key?: string; value?: string; _id?: string }[];
      usage?: 0 | 1 | 2 | 3 | 4 | 5 | -1 | -2 | -3;
      insertTime?: string;
      updateTime?: string;
      _id?: string;
    };
  };

  type getCoreRagInfoIpmiChunkDetailParams = {
    ragChunkCode: string;
  };

  type getCoreRagInfoIpmiDetailParams = {
    ragCode: string;
  };

  type getCoreRagInfoIpmiMaterialDetailParams = {
    ragMaterialCode: string;
  };

  type getCoreRagInfoIpmiSegmentDetailParams = {
    ragSegmentCode: string;
  };

  type getCoreRagMyChunkDetailParams = {
    ragChunkCode: string;
  };

  type getCoreRagMyDetailParams = {
    ragCode: string;
  };

  type getCoreRagMyMaterialDetailParams = {
    ragMaterialCode: string;
  };

  type getCoreRagMySegmentDetailParams = {
    ragSegmentCode: string;
  };

  type RagChunk = {
    /** 分句标识 */
    ragChunkCode: string;
    /** 知识库标识 */
    ragCode?: string;
    /** 材料标识 */
    ragMaterialCode?: string;
    /** 分段标识 */
    ragSegmentCode?: string;
    /** 分句文本 */
    content?: string;
    /** 分句位置序号 */
    position?: number;
    /** 分句的字符数量 */
    wordCount?: number;
    /** 材料的语言 */
    language?: string;
    /** 材料所有者 */
    operator?: { userCode?: string; realName?: string };
    /** 状态 */
    status?: -1 | 0 | 1;
    /** 标签 */
    tags?: { key?: string; value?: string }[];
    /** 材料使用情况 */
    usage?: 0 | 1 | 2 | 3 | 4 | 5 | -1 | -2 | -3;
  };

  type RagInfo = {
    /** 知识库标识 */
    ragCode: string;
    /** 知识库标题 */
    title?: string;
    /** 知识库描述 */
    description?: string;
    /** 知识库类型 */
    ragType?: 'builtIn' | 'dify' | 'self';
    /** 扩展元数据 */
    metas?: Record<string, any>;
    /** 知识库所有者 */
    operator?: Record<string, any>;
    /** 状态 */
    status?: -1 | 0 | 1;
    /** 标签 */
    tags?: { key?: string; value?: string }[];
    /** 向量模型提供商 */
    embeddingModelProvider?: string;
    /** 向量模型ID */
    embeddingModelId?: string;
    /** 访问权限 */
    permission?: 'union' | 'onlyMe' | 'platform' | 'departmentDirect' | 'departmentALL';
  };

  type RagMaterial = {
    /** 材料标识 */
    ragMaterialCode: string;
    /** 知识库类型 */
    ragType?: 'builtIn' | 'dify' | 'self';
    /** 材料物理路径 */
    physicalPath?: string;
    /** 材料格式 */
    format?: string;
    /** 材料的文本数据信息 */
    details?: {
      text?: string;
      wordCount?: number;
      tokens?: number;
      language?: string;
      isOriginal?: number;
    }[];
    /** 扩展元数据 */
    metas?: Record<string, any>;
    /** 知识库标识 */
    ragCode?: string;
    /** 材料使用情况 */
    usage?: 0 | 1 | 2 | 3 | 4 | 5 | -1 | -2 | -3;
    /** 材料添加者 */
    operator?: { userCode?: string; realName?: string };
    /** 状态 */
    status?: -1 | 0 | 1;
    /** 标签 */
    tags?: { key?: string; value?: string }[];
    /** 资源标识 */
    resCode?: string;
    /** 资源标题 */
    resTitle?: string;
    /** 资源原文链接 */
    resOriginalUrl?: string;
    /** 材料特别描述 */
    description?: string;
  };

  type RagSearchItem = {
    /** 知识库标识 */
    ragCode?: string;
    /** 材料标识 */
    ragMaterialCode?: string;
    /** 片段标识 */
    ragSegmentCode?: string;
    /** 片段文本 */
    content?: string;
    /** 材料原文标识 */
    resCode?: string;
    /** 材料原文标题 */
    resTitle?: string;
    /** 材料原文访问地址 */
    resOriginalUrl?: string;
  };

  type RagSegment = {
    /** 分段标识 */
    ragSegmentCode: string;
    /** 知识库标识 */
    ragCode?: string;
    /** 材料标识 */
    ragMaterialCode?: string;
    /** 分段文本 */
    content?: string;
    /** 分段位置序号 */
    position?: number;
    /** 分段的字符数量 */
    wordCount?: number;
    /** 分段的tokens数量 */
    tokens?: number;
    /** 材料的语言 */
    language?: string;
    /** 材料所有者 */
    operator?: { userCode?: string; realName?: string };
    /** 状态 */
    status?: -1 | 0 | 1;
    /** 标签 */
    tags?: { key?: string; value?: string }[];
    /** 材料使用情况 */
    usage?: 0 | 1 | 2 | 3 | 4 | 5 | -1 | -2 | -3;
  };
}
