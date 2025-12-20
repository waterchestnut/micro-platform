declare namespace RESOURCEAPI {
  type Dataset = {
    /** 资源标识 */
    resCode: string;
    /** 标题 */
    title?: string;
    /** 统计局平台的标识 */
    datasetCode?: string;
    /** 数据来源 */
    source?: string;
    /** 状态 */
    status?: number;
    /** 扩展信息 */
    extData?: Record<string, any>;
  };

  type DoubanBook = {
    /** 资源标识 */
    resCode: string;
    doubanCode?: string;
    doubanCodeNum?: number;
    isbn?: string;
    ubn?: string;
    issn?: string;
    title?: string;
    subtitle?: string;
    coverUrl?: string;
    abstract?: string;
    creator?: string;
    creatorAbstract?: string;
    publisher?: string;
    producer?: string;
    publishDate?: string;
    translator?: string;
    originalName?: string;
    pageNum?: string;
    price?: string;
    layout?: string;
    catalog?: string;
    series?: string;
    singlePrice?: string;
    websiteUrl?: string;
    extData?: Record<string, any>;
    status?: number;
    vector?: string;
    eigen?: Record<string, any>;
  };

  type fullDefinitionModels = {
    /** FileInfo */
    FileInfo?: {
      uid?: string;
      lastModified?: number;
      lastModifiedDate?: string;
      name?: string;
      size?: number;
      type?: string;
      percent?: number;
      status?: string;
      fileCode?: string;
      fileHashCode?: string;
      fileExt?: string;
      url?: string;
    };
    /** Operator */
    Operator?: { userCode?: string; realName?: string };
    /** Source */
    Source?: {
      title?: string;
      description?: string;
      href?: string;
      sourceKey?: string;
      openAccess?: boolean;
    };
    /** Tag */
    Tag?: { key?: string; value?: string };
  };

  type fullEnumModels = {
    /** RagStatusEnum */
    RagStatusEnum?: { error?: number; wait?: number; handling?: number; success?: number };
    /** ResManageTypeEnum */
    ResManageTypeEnum?: { union?: string; platform?: string; self?: string; literature?: string };
    /** ResTypeEnum */
    ResTypeEnum?: {
      book?: string;
      thesis?: string;
      journal?: string;
      dataset?: string;
      video?: string;
      patent?: string;
      audio?: string;
      image?: string;
      standard?: string;
      article?: string;
      exercise?: string;
      meeting?: string;
      upload?: string;
    };
    /** StatusEnum */
    StatusEnum?: { deleted?: number; normal?: number; disabled?: number };
  };

  type fullParamModels = {
    /** Dataset */
    Dataset?: {
      resCode: string;
      title?: string;
      datasetCode?: string;
      source?: string;
      status?: number;
      extData?: Record<string, any>;
    };
    /** DoubanBook */
    DoubanBook?: {
      resCode: string;
      doubanCode?: string;
      doubanCodeNum?: number;
      isbn?: string;
      ubn?: string;
      issn?: string;
      title?: string;
      subtitle?: string;
      coverUrl?: string;
      abstract?: string;
      creator?: string;
      creatorAbstract?: string;
      publisher?: string;
      producer?: string;
      publishDate?: string;
      translator?: string;
      originalName?: string;
      pageNum?: string;
      price?: string;
      layout?: string;
      catalog?: string;
      series?: string;
      singlePrice?: string;
      websiteUrl?: string;
      extData?: Record<string, any>;
      status?: number;
      vector?: string;
      eigen?: Record<string, any>;
    };
    /** Patent */
    Patent?: {
      resCode: string;
      title?: string;
      patentCode?: string;
      source?: string;
      status?: number;
      extData?: Record<string, any>;
    };
    /** ResInfo */
    ResInfo?: {
      resCode: string;
      title?: string;
      author?: string[];
      abstract?: string;
      publisher?: string;
      publishDate?: string;
      resType?:
        | 'book'
        | 'thesis'
        | 'journal'
        | 'dataset'
        | 'video'
        | 'patent'
        | 'audio'
        | 'image'
        | 'standard'
        | 'article'
        | 'exercise'
        | 'meeting'
        | 'upload';
      sources?: {
        title?: string;
        description?: string;
        href?: string;
        sourceKey?: string;
        openAccess?: boolean;
      }[];
      url?: string;
      operator?: { userCode?: string; realName?: string };
      coverUrl?: string;
      status?: -1 | 0 | 1;
      tags?: { key?: string; value?: string }[];
      keywords?: string[];
      fileList?: {
        uid?: string;
        lastModified?: number;
        lastModifiedDate?: string;
        name?: string;
        size?: number;
        type?: string;
        percent?: number;
        status?: string;
        fileCode?: string;
        fileHashCode?: string;
        fileExt?: string;
        url?: string;
      }[];
      fileHashCodes?: string[];
      fileExts?: string[];
      originalHashCode?: string;
      manageTypes?: ('union' | 'platform' | 'self' | 'literature')[];
      originalResCode?: string;
      ragMaterialCode?: string;
      ragStatus?: -1 | 0 | 1 | 2;
      llmChannelGroup?: string;
      llmExplain?: string;
      latestReadTime?: string;
    };
    /** Standard */
    Standard?: {
      resCode: string;
      title?: string;
      standardCode?: string;
      source?: string;
      status?: number;
      extData?: Record<string, any>;
    };
    /** searchItemSchema 详情 */
    searchItemSchema?: {
      content?: string;
      resCode?: string;
      title?: string;
      author?: string;
      publisher?: string;
      coverUrl?: string;
      isbn?: string;
      url?: string;
    };
  };

  type fullStoreModels = {
    /** Dataset */
    Dataset?: {
      resCode: string;
      title?: string;
      datasetCode?: string;
      source?: string;
      status?: number;
      extData?: Record<string, any>;
      insertTime?: string;
      updateTime?: string;
      _id?: string;
    };
    /** DoubanBook */
    DoubanBook?: {
      resCode: string;
      doubanCode?: string;
      doubanCodeNum?: number;
      isbn?: string;
      ubn?: string;
      issn?: string;
      title?: string;
      subtitle?: string;
      coverUrl?: string;
      abstract?: string;
      creator?: string;
      creatorAbstract?: string;
      publisher?: string;
      producer?: string;
      publishDate?: string;
      translator?: string;
      originalName?: string;
      pageNum?: string;
      price?: string;
      layout?: string;
      catalog?: string;
      series?: string;
      singlePrice?: string;
      websiteUrl?: string;
      extData?: Record<string, any>;
      status?: number;
      insertTime?: string;
      updateTime?: string;
      vector?: string;
      eigen?: Record<string, any>;
      _id?: string;
    };
    /** Patent */
    Patent?: {
      resCode: string;
      title?: string;
      patentCode?: string;
      source?: string;
      status?: number;
      extData?: Record<string, any>;
      insertTime?: string;
      updateTime?: string;
      _id?: string;
    };
    /** ResInfo */
    ResInfo?: {
      resCode: string;
      title?: string;
      author?: string[];
      abstract?: string;
      publisher?: string;
      publishDate?: string;
      resType?:
        | 'book'
        | 'thesis'
        | 'journal'
        | 'dataset'
        | 'video'
        | 'patent'
        | 'audio'
        | 'image'
        | 'standard'
        | 'article'
        | 'exercise'
        | 'meeting'
        | 'upload';
      sources?: {
        title?: string;
        description?: string;
        href?: string;
        sourceKey?: string;
        openAccess?: boolean;
        _id?: string;
      }[];
      url?: string;
      operator?: { userCode?: string; realName?: string; _id?: string };
      coverUrl?: string;
      status?: -1 | 0 | 1;
      tags?: { key?: string; value?: string; _id?: string }[];
      keywords?: string[];
      fileList?: {
        uid?: string;
        lastModified?: number;
        lastModifiedDate?: string;
        name?: string;
        size?: number;
        type?: string;
        percent?: number;
        status?: string;
        fileCode?: string;
        fileHashCode?: string;
        fileExt?: string;
        url?: string;
        _id?: string;
      }[];
      fileHashCodes?: string[];
      fileExts?: string[];
      originalHashCode?: string;
      manageTypes?: ('union' | 'platform' | 'self' | 'literature')[];
      originalResCode?: string;
      ragMaterialCode?: string;
      ragStatus?: -1 | 0 | 1 | 2;
      llmChannelGroup?: string;
      llmExplain?: string;
      insertTime?: string;
      updateTime?: string;
      latestReadTime?: string;
      _id?: string;
    };
    /** Standard */
    Standard?: {
      resCode: string;
      title?: string;
      standardCode?: string;
      source?: string;
      status?: number;
      extData?: Record<string, any>;
      insertTime?: string;
      updateTime?: string;
      _id?: string;
    };
  };

  type getCoreResInfoIpmiDetailParams = {
    resCode: string;
  };

  type getCoreResMyDetailParams = {
    resCode: string;
  };

  type getPublicBinResourceThesisDetailParams = {
    /** 资源标识 */
    resCode?: string;
  };

  type Patent = {
    /** 资源标识 */
    resCode: string;
    /** 标题 */
    title?: string;
    /** 公开（公告）号 */
    patentCode?: string;
    /** 数据来源 */
    source?: string;
    /** 状态 */
    status?: number;
    /** 扩展信息 */
    extData?: Record<string, any>;
  };

  type ResInfo = {
    /** 资源标识 */
    resCode: string;
    /** 标题 */
    title?: string;
    /** 作者 */
    author?: string[];
    /** 摘要与简介 */
    abstract?: string;
    /** 出版社 */
    publisher?: string;
    /** 出版时间 */
    publishDate?: string;
    /** 类型 */
    resType?:
      | 'book'
      | 'thesis'
      | 'journal'
      | 'dataset'
      | 'video'
      | 'patent'
      | 'audio'
      | 'image'
      | 'standard'
      | 'article'
      | 'exercise'
      | 'meeting'
      | 'upload';
    /** 来源 */
    sources?: {
      title?: string;
      description?: string;
      href?: string;
      sourceKey?: string;
      openAccess?: boolean;
    }[];
    /** 链接 */
    url?: string;
    /** 创建者 */
    operator?: { userCode?: string; realName?: string };
    /** 封面图 */
    coverUrl?: string;
    /** 状态 */
    status?: -1 | 0 | 1;
    /** 标签 */
    tags?: { key?: string; value?: string }[];
    /** 关键词 */
    keywords?: string[];
    /** 上传的文件材料 */
    fileList?: {
      uid?: string;
      lastModified?: number;
      lastModifiedDate?: string;
      name?: string;
      size?: number;
      type?: string;
      percent?: number;
      status?: string;
      fileCode?: string;
      fileHashCode?: string;
      fileExt?: string;
      url?: string;
    }[];
    /** 文件内容的hash值 */
    fileHashCodes?: string[];
    /** 文件后缀 */
    fileExts?: string[];
    /** 源文件的hash值 */
    originalHashCode?: string;
    /** 资源管理类型 */
    manageTypes?: ('union' | 'platform' | 'self' | 'literature')[];
    /** 源资源标识 */
    originalResCode?: string;
    /** 资源RAG的材料标识 */
    ragMaterialCode?: string;
    /** 资源RAG的状态 */
    ragStatus?: -1 | 0 | 1 | 2;
    /** 大模型会话频道内的分组 */
    llmChannelGroup?: string;
    /** 大模型对资源内容的解读 */
    llmExplain?: string;
    /** 最近阅读时间 */
    latestReadTime?: string;
  };

  type searchItemSchema = {
    /** 文本 */
    content?: string;
    /** 标识 */
    resCode?: string;
    /** 标题 */
    title?: string;
    /** author */
    author?: string;
    /** publisher */
    publisher?: string;
    /** coverUrl */
    coverUrl?: string;
    /** isbn */
    isbn?: string;
    /** 原文访问地址 */
    url?: string;
  };

  type Standard = {
    /** 资源标识 */
    resCode: string;
    /** 标题 */
    title?: string;
    /** 国家标准全文公开系统的标识 */
    standardCode?: string;
    /** 数据来源 */
    source?: string;
    /** 状态 */
    status?: number;
    /** 扩展信息 */
    extData?: Record<string, any>;
  };
}
