/**
 * @description 系统配置文件
 * @module conf/system.config
 */
import dotenv from 'dotenv'
import {relayModels, legacyModelAliases} from './llmModel.js'

// Read the .env file
dotenv.config()

export default {
    /** debug为true时，为调试模式 */
    debug: process.env['debug'] ? process.env['debug'] === 'true' : true,
    /** 部署环境需要修改，mongodb数据库配置 */
    mongodbConfig: {
        uri: process.env['MONGO_URI'],
        options: {
            dbName: process.env['MONGO_DB'],
            maxPoolSize: 100,
            minPoolSize: 2,
            socketTimeoutMS: 30000,
            serverSelectionTimeoutMS: 30000,
            autoIndex: true,
            user: process.env['MONGO_USER'],
            pass: process.env['MONGO_PASS'],
            authSource: 'admin'
        }
    },
    /** redis 配置，存储session等信息 */
    redisConfig: {
        host: process.env['REDIS_HOST'],
        port: parseInt(process.env['REDIS_PORT']),
        db: parseInt(process.env['REDIS_DB']),
        username: process.env['REDIS_USERNAME'],
        password: process.env['REDIS_PASSWORD']
    },
    /** 分布式锁的Redis配置 */
    redlockRedis: process.env['REDLOCK_URI'],
    /** 加密cookie的秘钥 */
    cookieSecret: process.env['COOKIE_SECRET'],
    /** 默认缓存数据过期时间，单位：分钟 */
    cacheExpiresTime: 60 * 24 * 7,
    /** 域名跨域访问的白名单 */
    allowedOrigins: [/localhost(:\d*)?$/, /127\.0\.0\.1(:\d*)?$/, /jtxuexi\.com(:\d*)?$/],
    /** kafka相关的配置 */
    kafka: {
        /** 客户端ID */
        clientId: process.env['KAFKA_CLIENTID'],
        brokers: process.env['KAFKA_BROKERS'].split(','),
        sasl: {
            mechanism: process.env['KAFKA_SASL_MECHANISM'],
            username: process.env['KAFKA_SASL_USERNAME'],
            password: process.env['KAFKA_SASL_PASSWORD']
        },
        retry: {
            retries: true,
            retryDelay: 3000
        },
        autocreateTopics: true,
        /** 消息组相关配置 */
        topics: {
            /** 统计信息 */
            statistic: {
                topic: process.env['KAFKA_STATISTIC_TOPIC'],
                groupId: process.env['KAFKA_STATISTIC_GROUPID']
            },
            /** 智能体任务处理 */
            agentTask: {
                topic: process.env['KAFKA_AGENT_TASK_TOPIC'],
                groupId: process.env['KAFKA_AGENT_TASK_GROUPID']
            },
            /** 记忆抽取任务 */
            memoryExtract: {
                topic: process.env['KAFKA_MEMORY_EXTRACT_TOPIC'] || 'memory_extract',
                groupId: process.env['KAFKA_MEMORY_EXTRACT_GROUPID'] || 'memory-extract-llm-api'
            },
            /** 抽取重试耗尽后进死信，避免 poison message 卡消费组 */
            memoryExtractDlq: {
                topic: process.env['KAFKA_MEMORY_EXTRACT_DLQ_TOPIC'] || 'memory_extract_dlq'
            },
        }
    },
    /** 轮询任务配置 */
    cron: {
        /** 示例轮询时间配置 */
        demoPattern: '0 45 2 * * *', //每天凌晨2点45分执行
        /** 缓存压实与记忆清理；默认关——迁移完成时不改运行行为，env 设 true 开启（多副本靠 redis 锁保证单执行） */
        retentionPattern: process.env['cron_retentionPattern'] || '45 3 * * *',
        retentionEnabled: process.env['cron_retentionEnabled'] === 'true',
        /**
         * 遗弃 run 回填（把"账本说在跑、档案却没一行"的行补成一条可见的 abort）。
         * 两道开关默认都关：这个任务写的是**用户会看见的档案行**，
         * 所以 Enabled（注册与否）与 Write（只出计划 / 真写库）要能分别回退。
         */
        backfillPattern: process.env['cron_backfillPattern'] || '15 4 * * *',
        backfillEnabled: process.env['cron_backfillEnabled'] === 'true',
        backfillWrite: process.env['cron_backfillWrite'] === 'true',
        /** 心跳静默多久算遗弃：必须 ≥ 最长 run 墙钟的 3 倍，否则一次长生成会被判死并补 abort */
        backfillOlderThanMs: Number(process.env['cron_backfillOlderThanMs']) || 600000,
        backfillLimit: Number(process.env['cron_backfillLimit']) || 200,
        /**
         * agentTask 中断恢复（`tasks/agentTaskRecover.js`）。
         *
         * **模板这边默认不注册**（`recoverEnabled === 'true'`），与本文件里 retentionEnabled /
         * backfillEnabled 同一惯例：新任务默认不改变运行行为。源仓 dev 是默认开的，那边有实测依据
         * （consumer 停摆、重投只堆积）——模板继承那个默认等于替每个部署方做决定。
         *
         * `recoverMode` 留空串表示"没配"，默认值归 `services/agent/recoverPolicy.js` 所有；
         * 配置层不许提前代入默认值，否则启动日志会把"没人配过"说成"按配置生效"。
         *
         * `recoverWindowMs`（滞留多久以内还值得救）为什么必须有：源仓 2026-11-11 实测滞留候选 5211 条、
         * 批次上限 10、按 `updateTime` 升序取前 N ⇒ 队首被永不收敛的陈旧行占死，新滞后的任务根本进不了本轮；
         * 而只把它们排除掉又会让队首换成半年前的任务被真重跑。判据与默认值出处见 recoverPolicy 文件头。
         */
        recoverEnabled: process.env['cron_recoverEnabled'] === 'true',
        recoverPattern: process.env['cron_recoverPattern'] || '*/10 * * * *',
        recoverMode: process.env['cron_recoverMode'] || '',
        recoverBatch: Number(process.env['cron_recoverBatch']) || 10,
        recoverStuckMs: Number(process.env['cron_recoverStuckMs']) || 30 * 60 * 1000,
        recoverWindowMs: process.env['cron_recoverWindowMs'] || '',
        recoverMaxTimes: Number(process.env['cron_recoverMaxTimes']) || 2,
        /** 显式锁时区，避免不同机器时区不一致导致错时 */
        timezone: process.env['cron_timezone'] || 'Asia/Shanghai',
    },
    /** 用户授权中心的配置 */
    ucenterConfig: {
        /** 基地址 */
        baseUrl: process.env['UCENTER_URI'],
        /** 内网基地址 */
        baseIntranetUrl: process.env['UCENTER_URI_INTRANET'],
        /** rpc服务的地址 */
        grpcHost: process.env['UCENTER_GRPC'],
        /**
         * u2u 热路径的 gRPC 截止。
         * grpc-js 不给 deadline 就是无限等：ucenter 连接在但服务不返回时既不 resolve 也不 reject，
         * `mentorContact` 的 fail-closed 就永远不触发，发消息的人卡死在关系校验上。
         * 这个值的作用是"让拒绝有可能发生"，不是性能参数。
         */
        grpcTimeoutMs: parseInt(process.env['UCENTER_GRPC_TIMEOUT_MS'] || 3000),
        /**
         * u2u 建会话/发消息的关系校验开关（PR-E0.7 写侧）。
         * **默认开**：设成 false 只用于发布顺序应急（ucenter 的 mentor 接口必须先上线），
         * 且每次放行都会留下 warn，便于事后审计。
         */
        contactCheckEnabled: process.env['U2U_CONTACT_CHECK_ENABLED'] !== 'false',
        /** 最大传送数据：256M */
        maxMessageLength: 256 * 1024 * 1024,
    },
    /** 智能体任务的配置 */
    agentTask: {
        /** 最大传送数据：256M */
        maxMessageLength: 256 * 1024 * 1024,
        /**
         * 执行认领（lease）的时长。两条约束一起决定它：
         * ① 必须**大于单个任务的最长正常执行时间**，否则跑到一半租约到期，保护形同虚设；
         * ② 必须**不超过恢复滞留阈值的一半**（`leaseSafety` 会算，启动时不满足就打告警），
         *    否则"还在正常执行"的任务会被恢复轮当成可救。
         * 续期由 `execAgentTask` 按四分之一个租约的节奏自动 extend，所以它不需要等于最坏时长。
         */
        execLeaseMs: Number(process.env['agentTask_execLeaseMs']) || 15 * 60 * 1000,
    },
    /**
     * 分层长期记忆（memory-plan PR-4~8/11/12 迁移）。
     * 默认全关：enabled=false 时 capture 零写入、召回不注入、工具不下发，行为与迁移前一致。
     * extract.model 必须指向本文件 models 段的键（env 可换）。
     */
    memory: {
        /** 总开关 */
        enabled: process.env['memory_enabled'] === 'true',
        /** 检索后端：mongoLexical（兜底，纯本仓）| rag（复用 rag.api 的 Milvus + ES） */
        store: process.env['memory_store'] || 'mongoLexical',
        /** 抽取用模型与预算，与主聊天完全隔离；走 Kafka 异步，不占聊天延迟 */
        extract: {
            model: process.env['memory_extract_model'] || 'relay_common_flash',
            fallbackModel: process.env['memory_extract_fallbackModel'] || 'relay_common_low',
            maxTokens: parseInt(process.env['memory_extract_maxTokens'] || 2048),
            timeoutMs: parseInt(process.env['memory_extract_timeoutMs'] || 60000),
            maxRetries: parseInt(process.env['memory_extract_maxRetries'] || 2),
            retryBackoffMs: parseInt(process.env['memory_extract_retryBackoffMs'] || 1000),
            temperature: parseFloat(process.env['memory_extract_temperature'] || 0.2),
            /** 已知的 Qwen3/QwQ 类模型关闭思考，避免抽取被推理占满 */
            disableThinking: process.env['memory_extract_disableThinking'] !== 'false',
        },
        /** 召回预算与排序 */
        recall: {
            tokens: parseInt(process.env['memory_recall_tokens'] || 1500),
            topK: parseInt(process.env['memory_recall_topK'] || 12),
            /** 单源硬超时，超时即 fail-open 跳过注入，绝不拖慢聊天 */
            timeoutMs: parseInt(process.env['memory_recall_timeoutMs'] || 800),
            /** 时间衰减半衰期（天） */
            recencyTauDays: parseFloat(process.env['memory_recall_recencyTauDays'] || 30),
            /** 每主题最多几条，避免同主题淹没 */
            perTopicCap: parseInt(process.env['memory_recall_perTopicCap'] || 2),
            /** 持久命中足够时是否压制原始事件回退 */
            suppressRaw: process.env['memory_recall_suppressRaw'] !== 'false',
            minConfidence: parseFloat(process.env['memory_recall_minConfidence'] || 0.4),
            /** 同主题两代说法的塌缩阈值 */
            siblingOverlapSimilarity: parseFloat(process.env['memory_recall_siblingOverlapSimilarity'] || '0.25'),
        },
        /** 语义索引（rag.api 的 memory collection）参数，阈值 0.5 依据 llm.api 侧实测校准 */
        index: {
            minSimilarity: parseFloat(process.env['memory_index_minSimilarity'] || '0.5'),
            writeTimeoutMs: parseInt(process.env['memory_index_writeTimeoutMs'] || 8000),
        },
        /** 来源权重：显式保存 > owner 文档 > 晋升 > 自动 */
        sourceWeight: {
            user_save: 3,
            manual_doc: 2.5,
            promoted: 1.5,
            auto: 1,
        },
        /** 晋升阈值 */
        promotion: {
            /** 低于此置信度不自动生效，转人工复核 */
            autoMinConfidence: parseFloat(process.env['memory_promotion_autoMinConfidence'] || 0.6),
            /** 相似度达到此值视为同一条事实，只并证据不新增 */
            dupSimilarity: parseFloat(process.env['memory_promotion_dupSimilarity'] || 0.92),
            /** 相似度达到此值视为可能冲突，需判定替代或并存 */
            conflictSimilarity: parseFloat(process.env['memory_promotion_conflictSimilarity'] || 0.55),
        },
        entity: {
            /** 脏原子数达到阈值才重生成实体页，避免每次写都重算 */
            regenThreshold: parseInt(process.env['memory_entity_regenThreshold'] || 5),
        },
        retention: {
            eventTtlDays: parseInt(process.env['memory_retention_eventTtlDays'] || 30),
            candidateTtlDays: parseInt(process.env['memory_retention_candidateTtlDays'] || 7),
            journalTtlDays: parseInt(process.env['memory_retention_journalTtlDays'] || 365),
            /** 空命名空间回收前的静默天数 */
            idleRecycleDays: parseInt(process.env['memory_retention_idleRecycleDays'] || 180),
        },
    },
    /**
     * 上下文与留档的硬边界（PR-11 段；工具结果裁剪部分待 llmChat 升级后生效，
     * answerCache 两项由 tasks/retention.js 直接读取）。
     */
    limits: {
        toolResultTokens: parseInt(process.env['limits_toolResultTokens'] || 1200),
        toolResultHeadChars: parseInt(process.env['limits_toolResultHeadChars'] || 900),
        toolResultTailChars: parseInt(process.env['limits_toolResultTailChars'] || 300),
        /**
         * 工具**入参**进档案/下发的字符预算（与源仓 llm.api 同步）。
         * 2026-11-12 现网复跑读数：dev 151 条调用记录里仅 3 条带 args 键（2.0%），
         * argsChars 观测值 2/52/53，入参被裁 0 次 ⇒ **这条预算目前不是约束项**，
         * 默认值维持 4000 是"照结果预览尺度对齐"，不是照入参数据定的。
         */
        toolArgsChars: parseInt(process.env['limits_toolArgsChars'] || 4000),
        /**
         * 工具**结果**进 trace（历史视图里那份预览）的字符预算。
         * 默认值与源仓改造前的硬编码逐字相同 ⇒ 同步本身不改行为，只是把"调不动"变成"可配"；
         * 现网实测有 24/148 条调用记录正好停在 4014（4000 + 14 字符标注），所以真正在削数据的是这一条。
         */
        toolResultTraceChars: parseInt(process.env['limits_toolResultTraceChars'] || 4000),
        overflowStoreChars: parseInt(process.env['limits_overflowStoreChars'] || 200000),
        /** answerCache 单频道最多保留多少条，超出由压实任务删除最旧的 */
        answerCacheMaxPerChannel: parseInt(process.env['limits_answerCacheMaxPerChannel'] || 5000),
        /** answerCache 的存活天数，写入时折算成 expireAt */
        answerCacheTtlDays: parseInt(process.env['limits_answerCacheTtlDays'] || 90),
        /**
         * 工具迭代上限（原来硬编码在 llmChat.js 里）。
         * 打满会截断回答：最后一轮以工具结果 continue、又被 reset 清空正文 ⇒ 空答案落库。
         * 默认 6 与原值一致，行为不变；上限由 llmLoop.MAX_ITERATIONS_CEILING 兜到 20。
         */
        maxIterations: parseInt(process.env['limits_maxIterations'] || '6'),
        /** 上限打满时是否补一次"无工具收尾调用"；设 false 则直接退化成"部分内容 + 可读原因" */
        maxIterationsFinalize: process.env['limits_maxIterationsFinalize'] !== 'false',
        /**
         * 并发闸（PR-0.4）。**默认全关**（`limit=0`）：不配就与改造前一致，不登记也不拒。
         *
         * 三条口径写在 `services/core/session/runGate.js` 文件头，最容易读错的一条：
         * **这是单进程闸**——PM2 每 worker 各数自己的，集群实际天花板 ≈ `limit × worker 数`；
         * 全局上限走下面的 `global`（redis Lua 原子计数，跨 worker 一份账），别把这里的数字当全局上限用。
         */
        concurrentRuns: {
            limit: parseInt(process.env['limits_concurrentRuns'] || '0'),
            perUserLimit: parseInt(process.env['limits_concurrentRunsPerUser'] || '0'),
            /** 拒的时候建议客户端多久后再试（会折算成 `Retry-After` 秒） */
            retryAfterMs: parseInt(process.env['limits_concurrentRunsRetryAfterMs'] || '1500'),
            /**
             * 全局闸（PR-0.4 剩余项，判据/执行在 `session/globalRunGate.js`）。默认关：
             * 关 ⇒ 一次 redis 调用都不发（同"plan 关着连 seed 查询都不发"的取向）。
             * 上限刻意**不在这配**——P-8 实测是单 pod 口径、relay 渠道余量归 P-13，
             * 全局 limit 复用本块的 `limit`/`perUserLimit`（开全局就是把同一数字换成全局账本执行，
             * 两套上限并存而不换算，比偷偷乘 worker 数诚实）。
             */
            global: {
                enabled: process.env['limits_concurrentRunsGlobal'] === 'true',
                /** 死账清理线：超过这个时长还没 release 的登记按崩溃残骸移除（崩溃自愈靠它，不是靠 TTL） */
                maxRunAgeMs: parseInt(process.env['limits_concurrentRunsGlobalMaxRunAgeMs'] || '900000'),
            },
        },
        /**
         * 同一会话"上一轮还没结束"的检测（P5）。与上面的并发闸口径不同：闸看总量/每人数（默认关、
         * 单进程计数），这里只看同一个 conversationCode，数据源是账本的 `progress:'processing'` 行，
         * 因而**跨 worker 可见**（PM2 两个 worker 的进程内登记表互相看不见，而"两个标签页问同一会话"
         * 恰恰常落到不同 worker）。
         * 默认开：并发时后一轮会**静默地**缺上下文（两轮都成功、都没提这件事）。
         * 拒绝窗口只有 1.5 秒，只覆盖"秒级重复"；超过窗口一律只记录不拒绝，
         * 免得一条僵尸 processing 行永久锁死一个会话。
         * 退回旧行为：`limits_runOverlapReject=0`（只记录）或 `limits_runOverlap=0`（整体关闭）。
         */
        runOverlap: {
            /** 显式 0 关闭检测（连账本都不查）；其余值都算开 */
            enabled: parseInt(process.env['limits_runOverlap'] || '1') !== 0,
            windowMs: parseInt(process.env['limits_runOverlapWindowMs'] || '1500'),
            reject: parseInt(process.env['limits_runOverlapReject'] || '1') !== 0,
        },
        /**
         * 过程分段（PR-B）的体积预算：单段 2000 字 × 8 段 + 总量 12000 字。
         * 依据是"被 reset 抹掉的中间正文最多 6 段、字数在百级"，
         * 增量因此与一条工具 trace 同量级；`answer`/`finalize` 段不存正文，不重复占体积。
         */
        segmentTextChars: parseInt(process.env['limits_segmentTextChars'] || 2000),
        segmentsMaxCount: parseInt(process.env['limits_segmentsMaxCount'] || 8),
        segmentsTotalChars: parseInt(process.env['limits_segmentsTotalChars'] || 12000),
        /**
         * 每 run 模型调用次数的告警/熔断阈值（§14）。
         * 不设默认熔断：阈值属于运维判断，代码不该替它决定；不设就是"只观测不断"。
         */
        runModelCallsWarn: parseInt(process.env['limits_runModelCallsWarn'] || '0') || null,
        runModelCallsHardLimit: parseInt(process.env['limits_runModelCallsHardLimit'] || '0') || null,
    },
    /** 两级缓存（PR-10）：memory 套件当前只用 extractDedupeSeconds，其余为整段一致性预置 */
    /**
     * SSE 输出通道
     * pingIntervalMs：静默多久发一帧 `:ping` 注释。取 8s 是因为它要同时远小于常见代理/网关的空闲超时
     * （生产 Traefik `idleTimeout` 180s 且无法通过 k8s Ingress 注解调整；dev nginx 默认 60s）。
     * 设 0 可整体关闭心跳（本地调试用）。
     */
    stream: {
        pingIntervalMs: parseInt(process.env['stream_pingIntervalMs'] || '8000'),
        /**
         * PR-C：断线续接的事件日志。默认开——D34 把续接定为可用性下限而不是优化项
         * （生产入口 Traefik idleTimeout=180s 且无法经 k8s Ingress 注解调整，连接必然被切）。
         * 三重上限是有意为之：单轮条数 / 单轮字节 / 全进程字节；超了就丢最早的并让续接报 gap，
         * 宁可让前端知道"续不上、去拿快照"，也不给半套事件。
         */
        resume: {
            enabled: process.env['streamResume_enabled'] !== 'false',
            maxEvents: parseInt(process.env['streamResume_maxEvents'] || '2000'),
            maxBytes: parseInt(process.env['streamResume_maxBytes'] || `${2 * 1024 * 1024}`),
            ttlMs: parseInt(process.env['streamResume_ttlMs'] || '120000'),
            maxRuns: parseInt(process.env['streamResume_maxRuns'] || '200'),
            maxTotalBytes: parseInt(process.env['streamResume_maxTotalBytes'] || `${32 * 1024 * 1024}`),
            /**
             * Redis 承载（跨副本续接）。**默认关**，这不是胆怯而是纪律：
             * 打开它等于在聊天关键路径上加一批 Redis 写，而"该给 prod 开多大容量"必须由
             * dev 的实测（往返次数、延迟、键内存占用）来定，不能由 dev 的数字直接拍给 prod
             * ——这与 `upstreamBreaker` 那次的做法一致。要在 dev 打开需设
             * `streamResume_redis_enabled=true`，然后按实测（往返次数、延迟、键内存）再决定 prod。
             */
            redis: {
                enabled: process.env['streamResume_redis_enabled'] === 'true',
                /** 单轮在 Stream 里保留的条目数（MAXLEN ~），与进程内 maxEvents 同量级 */
                maxEvents: parseInt(process.env['streamResume_redis_maxEvents'] || '2000'),
                /** 键的存活秒数：与进程内 ttlMs 同源含义，redis 侧只能按秒 */
                ttlSec: parseInt(process.env['streamResume_redis_ttlSec'] || '120'),
                /** 攒多少条发一次管道：省的是往返，不是条数 */
                flushEvery: parseInt(process.env['streamResume_redis_flushEvery'] || '25'),
                /** 攒不满也最多等这么多毫秒（0 = 只靠 flushEvery 与收尾） */
                flushMs: parseInt(process.env['streamResume_redis_flushMs'] || '200'),
                keyPrefix: process.env['streamResume_redis_keyPrefix'] || 'llmrun:events',
            },
        },
    },
    /**
     * 账本的实时行（v1.33）。默认开：这条改动的目的就是让"看不见的损失"变得看得见，
     * 默认关等于继续瞎。
     * 写放大上界：每 run 多 1+k 次**同一行的唯一索引更新**（k = 本 run 发起的上游调用数，
     * 正常 1~6、上限 20），不是新增文档；与检查点的写放大不同量级（检查点每条都带完整 messages）。
     * 关掉后 `listAbandoned()` 恒空——那不代表没有损失，只代表又开始瞎了。
     */
    llmUsageLive: {
        enabled: process.env['llmUsageLive_enabled'] !== 'false',
    },
    /**
     * u2u（用户间聊天）相关配置。
     */
    u2u: {
        /**
         * 实时推送开关。默认开——它是**缺陷修复**而不是新功能：
         * 服务端曾把 `publishU2uEvent` 连定义带调用整段注释掉，而前端收到 `connected`
         * 就把轮询兜底关掉（`u2u.tsx:728`），合起来是"页面开着就看不到对方新消息"。
         * 留开关只为上线首批止血；关掉等于把那个缺陷放回去。
         */
        pushEnabled: process.env['u2u_pushEnabled'] !== 'false',
    },
    cache: {
        skillEnabled: process.env['cache_skill'] !== 'false',
        skillTtlSeconds: Math.min(parseInt(process.env['cache_skillTtlSeconds'] || parseInt(process.env['cacheExpiresTime'] || 60 * 24 * 7) * 60) || 3600, 4 * 3600),
        skillLruTtlMs: parseInt(process.env['cache_skillLruTtlMs'] || 60000),
        skillLruMax: parseInt(process.env['cache_skillLruMax'] || 64),
        /** 同一会话的抽取任务在这个窗口内只投一次（抽取单次以几十秒计，重复投递是真金白银） */
        extractDedupeSeconds: parseInt(process.env['cache_extractDedupeSeconds'] || 60),
        /** MCP 工具清单在进程内的保鲜期 */
        toolsTtlSeconds: parseInt(process.env['cache_toolsTtlSeconds'] || 300),
    },
    /**
     * 直连 rag.api（D5：记忆向量索引必须指向 rag.api，不能绕 resource.api——那是环依赖）。
     * 内网直连 rag.api 同样信任网关注入的 user-info，调用方需自带该头。
     */
    ragConfig: {
        baseUrl: process.env['RAG_URI'] || 'http://localhost:12013',
        baseIntranetUrl: process.env['RAG_URI_INTRANET'] || 'http://localhost:12013',
        timeoutMs: parseInt(process.env['RAG_TIMEOUT_MS'] || 3000),
    },
    /** 上下文装配的预算配置（PR-1/PR-2） */
    context: {
        /** 预算 = contextWindow - maxTokens - slackTokens，预留思考与响应外的余量 */
        slackTokens: parseInt(process.env['context_slackTokens'] || 4096),
        /** 历史回放的默认最大轮次 */
        historyMaxTurns: parseInt(process.env['context_historyMaxTurns'] || 10),
        /** 会话预览/摘要用的档位（memory.api 生成预览文本时取这一档，不跟用户所选档位走） */
        previewModel: process.env['context_previewModel'] || 'relay_common_pro',
    },
    /**
     * 会话执行检查点（PR-9）：默认关闭。
     * 每条检查点都携带完整发送消息，写放大较大，先按环境打开观察容量再决定常开。
     */
    checkpoint: {
        enabled: process.env['checkpoint_enabled'] === 'true',
        /** 会话内 seq 超过该值触发折叠 */
        foldThreshold: parseInt(process.env['checkpoint_foldThreshold'] || 40),
        /** 折叠时保留最近多少条 */
        keepLast: parseInt(process.env['checkpoint_keepLast'] || 12),
        /** 收尾等待未落地检查点的上限 */
        flushTimeoutMs: parseInt(process.env['checkpoint_flushTimeoutMs'] || 1500),
    },
    /**
     * OpenSandbox 执行环境（PR-13~16 套件）。默认 enabled=false：不配不动任何行为。
     * 与来源仓的差异：baseUrl 无预置 IP 默认（未配置时调用抛可行动错误）；
     * defaultPoolRef 默认空=非池模式（不假设集群里存在某个池）。
     */
    sandboxConfig: {
        baseUrl: process.env['sandbox_baseUrl'] || '',
        /** apiKey 只从环境/Secret 注入，绝不写默认值 */
        apiKey: process.env['sandbox_apiKey'] || '',
        /** 沙箱内 execd 端口，与 lifecycle 的 endpoints/{port} 一起用 */
        execdPort: parseInt(process.env['sandbox_execdPort'] || 44772),
        requestTimeoutMs: parseInt(process.env['sandbox_requestTimeoutMs'] || 20000),
        /** 建箱专用超时：必须比 requestTimeoutMs 长，否则会出现"服务端已建好但客户端无 id"的孤儿 */
        createTimeoutMs: parseInt(process.env['sandbox_createTimeoutMs'] || 60000),
        readyTimeoutMs: parseInt(process.env['sandbox_readyTimeoutMs'] || 120000),
        execTimeoutMs: parseInt(process.env['sandbox_execTimeoutMs'] || 120000),
        /** 默认走池模式（extensions.poolRef）；配了策略/credentialProxy 必须置空关池 */
        defaultPoolRef: process.env['sandbox_defaultPoolRef'] || '',
        /** 非池模式才需要：镜像/入口/资源上限（spec：poolRef 缺省时 resourceLimits 必填） */
        defaultImage: process.env['sandbox_defaultImage'] || '',
        defaultEntrypoint: process.env['sandbox_defaultEntrypoint'] ? process.env['sandbox_defaultEntrypoint'].split(',') : undefined,
        defaultResourceLimits: process.env['sandbox_defaultResourceLimits'] ? JSON.parse(process.env['sandbox_defaultResourceLimits']) : undefined,
        /** 沙箱自动回收秒数；不设则依赖服务端 max_sandbox_timeout_seconds */
        defaultTimeoutSeconds: parseInt(process.env['sandbox_defaultTimeoutSeconds'] || 1800),
        /** skill 执行位置：'local' 保持进程内 import（向后兼容），'sandbox' 打包进沙箱 */
        skillExecMode: process.env['sandbox_skillExecMode'] === 'sandbox' ? 'sandbox' : 'local',
        /** 每个 skill 能拿到的宿主能力，未登记即无能力（不给默认） */
        skillCaps: process.env['sandbox_skillCaps'] ? JSON.parse(process.env['sandbox_skillCaps']) : {
            'document-extractor': ['extract'],
        },
        /** 架构上允许模型生成代码并在沙箱执行；关掉即不下发 run_code 工具 */
        allowModelCode: process.env['sandbox_allowModelCode'] !== 'false',
        /** 单次提交的代码长度上限 */
        maxCodeChars: parseInt(process.env['sandbox_maxCodeChars'] || 20000),
        /** 会话共享沙箱的复用窗口 */
        sharedTtlMs: parseInt(process.env['sandbox_sharedTtlMs'] || 10 * 60 * 1000),
        /** egress 侧车端口与可选鉴权（/policy、/credential-vault 都在侧车上，不在 lifecycle） */
        egressPort: parseInt(process.env['sandbox_egressPort'] || 18080),
        egressAuthToken: process.env['sandbox_egressAuthToken'] || '',
        /** 出网策略：不配即不收紧；create 直传（侧车只在 create 带策略时存在），建箱后 GET 回读校验 */
        egressPolicy: process.env['sandbox_egressPolicy'] ? JSON.parse(process.env['sandbox_egressPolicy']) : null,
        /** 策略回读失败时是否阻断（默认 true：宁可报错也不要"以为收紧了"） */
        egressEnforce: process.env['sandbox_egressEnforce'] !== 'false',
        /** Credential Vault（透明 MITM+凭据注入）。必须与 egressPolicy 同时开，且与池模式互斥 */
        credentialProxyEnabled: process.env['sandbox_credentialProxy'] === 'true',
        /** 默认不启用沙箱执行：与 D2 同一纪律，按环境开 */
        enabled: process.env['sandbox_enabled'] === 'true',
    },
    /**
     * 沙箱回连宿主的能力接口（/core/skill-host/*）。
     * 鉴权靠短期作用域 token（签名密钥用 cookieSecret）。baseUrl 要沙箱网络可达（集群内 Service 地址）。
     */
    skillHost: {
        /** 单次处理的字节上限（base64 会放大约 1.37 倍） */
        maxBytes: parseInt(process.env['skillHost_maxBytes'] || 20 * 1024 * 1024),
        /** 宿主代为下载文件时的超时 */
        fetchTimeoutMs: parseInt(process.env['skillHost_fetchTimeoutMs'] || 60000),
        /** 能力 token 有效期；要覆盖一次 skill 执行的最长耗时但别太长 */
        tokenTtlMs: parseInt(process.env['skillHost_tokenTtlMs'] || 15 * 60 * 1000),
        /** 沙箱可达的宿主服务地址（签进 token 环境）；默认本机端口，跨网部署必须显式配 */
        baseUrl: process.env['skillHost_baseUrl'] || 'http://localhost:12008',
    },
    /**
     * PR-15 沙箱用量与配额。默认关闭拦截（账本照写、fail-open 不阻断任何聊天）。
     * active 上限**在进程内**统计（多副本偏松是已知局限，宁松不假）。
     */
    sandboxQuota: {
        enabled: process.env['sandboxQuota_enabled'] === 'true',
        windowHours: parseInt(process.env['sandboxQuota_windowHours'] || 24),
        dailySecondsPerUser: parseInt(process.env['sandboxQuota_dailySecondsPerUser'] || 1800),
        maxSandboxesPerUser: parseInt(process.env['sandboxQuota_maxSandboxesPerUser'] || 0),
        maxActiveConversations: parseInt(process.env['sandboxQuota_maxActiveConversations'] || 0),
        reserveSeconds: parseInt(process.env['sandboxQuota_reserveSeconds'] || 60),
        maxSecondsPerSandbox: parseInt(process.env['sandboxQuota_maxSecondsPerSandbox'] || 3600),
        pricePerSecond: parseFloat(process.env['sandboxQuota_pricePerSecond'] || '0.0002'),
    },
    /** 执行大模型调用的模型配置：中转站「族 × 档」+ 历史别名（定义见 conf/llmModel.js） */
    models: {
        /** 12 个档位：relay_<族>_<档>，族 common/qwen/deepseek/qwen_vl，档 pro/flash/low */
        ...relayModels,
        /** 历史供应商名（qwenPlus、deepseek31 …）指向对应档位，老调用方与库里老数据不用改 */
        ...Object.fromEntries(Object.entries(legacyModelAliases).map(([legacy, target]) => [legacy, relayModels[target]])),
    },
    /**
     * 上游（中转站）调用的重试与换档。与源仓同名同义、env 也同名：
     * 一份运维约定覆盖模板与产品，不留"这边配了那边不认"的坑。
     * **默认关**：不配就与没有这层逻辑时逐字一致（一次失败直接抛给上层）。
     * 打开后只覆盖**首字节前的失败**——已经吐过字的调用重发会让用户看到重复内容。
     */
    upstreamRetry: {
        enabled: process.env['upstreamRetry_enabled'] === 'true',
        /** 同一档位最多打几次（含首发）；1 表示不重试但保留换档 */
        maxAttempts: parseInt(process.env['upstreamRetry_maxAttempts'] || '3', 10),
        /** 退避基准与上限（毫秒）。满抖动，见 `backoffMs` */
        baseMs: parseInt(process.env['upstreamRetry_baseMs'] || '300', 10),
        capMs: parseInt(process.env['upstreamRetry_capMs'] || '4000', 10),
        /**
         * 这里**故意不提供** `fallbackModel`（换档）。
         * 模板的 chat 侧只接了"退避 + 熔断 + 首字节护栏"；档位回退还需要换档 client map 与
         * 窗口可行性检查（源仓的 `fallbackClients` / `canFallbackTo`），没实现就不配暴露开关——
         * 一个"设了也没人读"的 env，正是本工作流一整天在清除的那类隐患。
         * 要支持换档时，请连同实现一起加回来。
         */
    },
    /**
     * 网关级熔断。存在理由与退避不同：多个模型档常常共用同一个中转出口与同一把 key，
     * 出口整体不可用时换档救不了，退避只会把"每个请求都失败"摊得更久。
     * 语义是**连续网关级失败达到阈值后一段时间内直接拒绝**，到期放一条半开探测。
     * **默认关**。源仓那侧的参数由账本量得（相邻失败 p50=62ms、失败→恢复 p50=9.6s），
     * 模板沿用同一组默认值，但真实阈值仍应由各服务自己的故障频次定。
     */
    upstreamBreaker: {
        enabled: process.env['upstreamBreaker_enabled'] === 'true',
        failureThreshold: parseInt(process.env['upstreamBreaker_failureThreshold'] || '5', 10),
        openMs: parseInt(process.env['upstreamBreaker_openMs'] || '15000', 10),
    },
    /**
     * 翻译链路的超时：**按请求体长度算**，不是固定值。
     * 依据是源仓 dev 实测（autoTrans 8 样本：34字/1822ms … 332字/6537ms，拟合约 15.8ms/字 + 1.28s）；
     * 这里取 base 30s + 30ms/字（≈斜率 1.9 倍余量），封顶 120s 对应 8000 字业务硬顶。
     * 为什么必须配：OpenAI SDK 默认 DEFAULT_TIMEOUT = 600000（10 分钟），
     * 配我方最多 3 次尝试 ⇒ 一次挂住的翻译可以占住 handler 约半小时。
     * 含图片的请求**不加超时**：OCR 没有实测样本，没测过的东西不配拥有系数
     * （见 services/core/upstreamTransClient.js 的 bodyHasImage 分支）。
     */
    trans: {
        timeout: {
            baseMs: parseInt(process.env['trans_timeoutBaseMs'] || '30000', 10),
            perCharMs: parseInt(process.env['trans_timeoutPerCharMs'] || '30', 10),
            maxMs: parseInt(process.env['trans_timeoutMaxMs'] || '120000', 10),
        },
    },
    /** 资源服务的配置 */
    resourceConfig: {
        /** 基地址 */
        baseUrl: process.env['RESOURCE_URI'],
        /** 内网基地址 */
        baseIntranetUrl: process.env['RESOURCE_URI_INTRANET'],
        /** rpc服务的地址 */
        grpcHost: process.env['RESOURCE_GRPC'],
        /** 最大传送数据：256M */
        maxMessageLength: 256 * 1024 * 1024,
    },
    /** 资源转换服务的配置 */
    transformConfig: {
        /** 基地址 */
        baseUrl: process.env['TRANSFORM_URI'],
        /** 内网基地址 */
        baseIntranetUrl: process.env['TRANSFORM_URI_INTRANET'],
        /** rpc服务的地址 */
        grpcHost: process.env['TRANSFORM_GRPC'],
        /** 最大传送数据：256M */
        maxMessageLength: 256 * 1024 * 1024,
    },
    /** ===== 以下配置块自源仓逐字抽取（搬运批 2b）：env 驱动、默认全关 ⇒ 无配置时零行为变化 ===== */
    /**
     * 计划外置（PR-M，§10/D25）。**默认全关**：不开 ⇒ `update_plan` 工具不下发、
     * recitation 不注入、计划不落档，主循环行为与加它之前逐字一致。
     * 判据全在 `session/planState.js`/`planTool.js`/`planAssembly.js`（纯函数、离线可测），
     * 这里只给"开关与预算"。开之前必须先在 relay 上验 recitation 的 role 是否被认（见 planAssembly 的 ⚠️）。
     */
    planConfig: {
        /** 是否下发 update_plan 并启用 recitation（默认关） */
        enabled: process.env['plan_enabled'] === 'true',
        /** recitation 注入文本的字符软上限（超了整项丢弃并声明"另有 N 项未显示"） */
        recitationMaxChars: parseInt(process.env['plan_recitationMaxChars'] || '1200'),
    },
    /**
     * run 退出前的收尾（PR-M 完成性反问接这里）。`selfCheck` 默认关：
     * 关 ⇒ 模型自称做完就照常结束；开 ⇒ 若计划仍有未结项，复用无工具收尾那条路追加一次反问。
     */
    finalize: {
        selfCheck: process.env['finalize_selfCheck'] === 'true',
    },
    /** doc.api 文件服务的配置（PR-H2 产物转投用；契约见 services/core/artifact/docApiUpload 头注释） */
    docApiConfig: {
        /** 基地址（对外域名，产下载 URL 用） */
        baseUrl: process.env['docApiConfig_baseUrl'] || 'http://localhost:12004',
        /** 内网基地址：与 ragStore 同款直连，需自带 user-info 头 */
        baseIntranetUrl: process.env['docApiConfig_baseIntranetUrl'] || 'http://doc-api-http',
        /** 单次请求超时（上传大文件比检索长得多） */
        timeoutMs: parseInt(process.env['docApiConfig_timeoutMs'] || 120000),
    },
    /** 产物入库（save_artifact → intake）的配置；默认关，同 plan_enabled 的"先可见后按需开" */
    artifactConfig: {
        enabled: process.env['artifact_enabled'] === 'true',
        /** 单文件字节上限（intake 的 maxTotalBytes 闸门；默认 64MB） */
        maxFileBytes: parseInt(process.env['artifact_maxFileBytes'] || 64 * 1024 * 1024),
        /** 分段拉取的单段上限（§0.1 实测 1MB 段精确） */
        sliceBytes: parseInt(process.env['artifact_sliceBytes'] || 1048576),
        /** 展示名长度上限 */
        maxNameChars: parseInt(process.env['artifact_maxNameChars'] || 120),
    },
    /**
     * PR-T0 上下文治理（D22）。判据全在 `context/constraints.js`（纯函数、离线可测），这里只给开关与槽预算。
     * 收益按 §16.4 P-2b 裁定记为**治理**（约束在压缩后存活），与缓存命中率无关；缓存腿等 P-13，不在此。
     */
    contextConfig: {
        constraints: {
            /** 默认关（同 plan_enabled 取向）：装配侧读到开才注入槽 */
            enabled: process.env['context_constraints_enabled'] === 'true',
            /** 槽的字符软上限：装不下 ⇒ 整条延后并如实报告，**绝不半截截断约束文本** */
            slotMaxChars: parseInt(process.env['context_constraints_slotMaxChars'] || '1200'),
            /** 单条约束文本上限（授权时把关，别让一条撑爆槽） */
            textMaxChars: parseInt(process.env['context_constraints_textMaxChars'] || '500'),
        },
    },
}
