/**
 * @fileOverview 记忆召回评测的合成语料
 * @module evals/memory/corpus
 * @description 为什么用手工固定语料而不是随机生成：评测要能复现、要能一眼看出"这条探针在考什么"，
 * 随机语料出的分数无法归因。语料刻意做成对词法检索不友好的形态——
 * 问题与事实共享的字面片段很少（问"一年买电子资源的钱"，事实写"数字资源采购预算 120 万元"），
 * 这正是词法召回与语义召回会拉开差距的地方，也是放量闸门要看的真实差距。
 */

/** 命名空间前缀，评测数据一律以此为头，跑完按前缀整体清除，绝不与真实用户混淆 */
export const EVAL_USER_PREFIX = 'eval-mem'

/** 评测专用频道，语料与之一致 */
export const EVAL_CHANNEL = 'micro_common'

/** 一天的毫秒数 */
const DAY = 86400000

/** 六个用户画像，字段用于填充事实与探针模板 */
const PROFILES = [
    {
        org: '明德图书馆', budget: 120, budgetWord: '数字资源采购预算', vendor: '启明数据', contact: '张明',
        schedule: '每周五下午', format: '表格', language: '中文', system: 'FOLIO', reader: '本科生',
        year: 2025, subject: '电子资源',
    },
    {
        org: '南湖校区图书馆', budget: 86, budgetWord: '纸质图书采购经费', vendor: '书林文化', contact: '李魏',
        schedule: '每月最后一个工作日', format: '分点条目', language: '中文', system: '汇文', reader: '研究生',
        year: 2024, subject: '外文原版书',
    },
    {
        org: '西苑分馆', budget: 45, budgetWord: '数据库续订费用', vendor: '汇文信息', contact: '陈秋',
        schedule: '周二上午', format: '简短结论加注释', language: '中文', system: 'Alma', reader: '教职工',
        year: 2026, subject: '学位论文库',
    },
    {
        org: '总馆资源建设部', budget: 210, budgetWord: '全文库采购盘子', vendor: '同网信息', contact: '赵鸣',
        schedule: '季度末最后一周', format: '对比清单', language: '中文', system: 'Koha', reader: '附属医院人员',
        year: 2025, subject: '医学文献库',
    },
    {
        org: '理工分馆', budget: 68, budgetWord: '专利数据库支出', vendor: '知产在线', contact: '孙禾',
        schedule: '每月 10 号', format: '带引用出处的段落', language: '中文', system: 'CALIS', reader: '工科教师',
        year: 2026, subject: '标准全文库',
    },
    {
        org: '密集库管理中心', budget: 32, budgetWord: '古籍影印出版拨款', vendor: '蔚文古籍', contact: '周庸',
        schedule: '寒暑假前两周', format: '要点列表', language: '中文', system: '自建库', reader: '古籍研究者',
        year: 2024, subject: '地方志影印本',
    },
]

/**
 * 事实模板：一条事实 = 一句独立可读的陈述。
 * gold 字段给出探针判定命中所需的字面片段（必须是事实里真实存在的连续文本）。
 */
function factsOf(p, idx) {
    return [
        {
            factId: `u${idx}-org`, topic: '机构身份', kind: 'profile', source: 'auto', confidence: 0.9, ageDays: 200,
            content: `用户所在单位是${p.org}，${p.reader}是主要服务对象。`,
        },
        {
            factId: `u${idx}-budget`, topic: '经费', kind: 'fact', source: 'auto', confidence: 0.85, ageDays: 160,
            content: `用户${p.year}年的${p.budgetWord}为${p.budget}万元，需要在${p.schedule}前提交材料。`,
        },
        {
            factId: `u${idx}-vendor`, topic: '供应商', kind: 'fact', source: 'auto', confidence: 0.8, ageDays: 130,
            content: `用户对接的${p.subject}供应商是${p.vendor}，联系人${p.contact}。`,
        },
        {
            factId: `u${idx}-format`, topic: '表达偏好', kind: 'preference', source: 'user_save', confidence: 1, ageDays: 95,
            content: `用户希望比较类的内容用${p.format}呈现，不要长篇叙述。`,
        },
        {
            factId: `u${idx}-lang`, topic: '语言偏好', kind: 'preference', source: 'user_save', confidence: 1, ageDays: 90,
            content: `用户要求助手所有回复都使用${p.language}，专业术语首次出现时附英文原文。`,
        },
        {
            factId: `u${idx}-system`, topic: '系统环境', kind: 'fact', source: 'auto', confidence: 0.75, ageDays: 70,
            content: `用户所在单位使用的图书馆管理系统是${p.system}，书目数据以该库为准。`,
        },
        {
            factId: `u${idx}-schedule`, topic: '流程时点', kind: 'decision', source: 'auto', confidence: 0.7, ageDays: 45,
            content: `用户的采购材料固定${p.schedule}提交，逾期要等下一个周期。`,
        },
        {
            /** 与 newFact 构成"同一主题两代说法"，模拟 PR-5 记录下来的短句相似度漏判并存现象 */
            factId: `u${idx}-subject-old`, topic: '职责范围', kind: 'fact', source: 'auto', confidence: 0.6, ageDays: 260,
            content: `用户负责${p.subject}的选型与续订。`,
            staleTwin: `u${idx}-subject-new`,
        },
        {
            factId: `u${idx}-subject-new`, topic: '职责范围', kind: 'fact', source: 'auto', confidence: 0.85, ageDays: 20,
            content: `用户现在只负责${p.subject}的续订，选型工作已经交给同事。`,
        },
        {
            /** 已退役的事实：召回绝不能注入，注入即为"过时事实"缺陷 */
            factId: `u${idx}-retired`, topic: '职责范围', kind: 'fact', source: 'auto', confidence: 0.9, ageDays: 300,
            state: 'retired', retired: true,
            content: `用户曾经全权负责${p.subject}的采购立项与谈判。`,
        },
    ]
}

/**
 * 探针模板：query 是用户会问的话，gold 是判定"上下文里确实有这条事实"的字面依据。
 * inWindow=false 的探针是评测的主战场——答案只在长期记忆里，窗口里没有。
 */
function probesOf(p, idx) {
    return [
        {
            probeId: `u${idx}-p-org`, query: '我这边主要是给谁做服务的？', goldFactId: `u${idx}-org`,
            goldSubstring: p.reader, inWindow: false,
        },
        {
            probeId: `u${idx}-p-budget`, query: `我今年买${p.subject}大概能花多少钱？`, goldFactId: `u${idx}-budget`,
            goldSubstring: `${p.budget}万元`, inWindow: false,
        },
        {
            probeId: `u${idx}-p-vendor`, query: '那家卖数据库的公司叫什么，找谁对接？', goldFactId: `u${idx}-vendor`,
            goldSubstring: p.contact, inWindow: false,
        },
        {
            probeId: `u${idx}-p-format`, query: '把几个方案放在一起比一比，你怎么给我排？', goldFactId: `u${idx}-format`,
            goldSubstring: p.format, inWindow: false,
        },
        {
            probeId: `u${idx}-p-system`, query: '我们书目数据以哪个库为准？', goldFactId: `u${idx}-system`,
            goldSubstring: p.system, inWindow: false,
        },
        {
            probeId: `u${idx}-p-schedule`, query: '我的材料一般什么时候要交？', goldFactId: `u${idx}-schedule`,
            goldSubstring: p.schedule, inWindow: false,
        },
        {
            /** 职责探针：新说法是正确答案，旧说法仍留在库里（PR-5 记录的短句并存），用来量冲突并存率 */
            probeId: `u${idx}-p-duty`, query: '选型那摊子事现在是谁在做？', goldFactId: `u${idx}-subject-new`,
            goldSubstring: '选型工作已经交给同事', inWindow: false,
        },
        {
            /** 反向探针：窗口里就有这句话，纯窗口也必须命中，用来排除"评测本身错了" */
            probeId: `u${idx}-p-window`, query: '我刚才说过的那句暗号是什么？', goldFactId: `u${idx}-window`,
            goldSubstring: '青苔计划', inWindow: true,
        },
    ]
}

/** 当前会话的近端轮次：窗口基线能看到的全部内容 */
function windowTurnsOf(p, idx) {
    return [
        {query: '帮我想个项目代号', answer: '可以用青苔计划，寓意是从旧环境里长出新东西。'},
        {query: '这个代号什么意思？', answer: '青苔计划强调在原有馆藏基础上生长出新的服务能力。'},
        {query: '先把刚才那句暗号记一下', answer: '好的，暗号是青苔计划。'},
        {query: '今天的会开到几点？', answer: '会议时间安排由你所在部门的值班表决定，我无法看到具体时刻。'},
        {query: '帮我列一下开会要带什么', answer: '建议带上待讨论清单、经费台账和供应商报价单。'},
        {query: '电子资源的试用反馈怎么收集', answer: '可以做一份简短问卷，收集使用频次与拒订理由。'},
    ].map((t, i) => ({
        messageCode: `u${idx}-win-${i}`,
        conversationCode: `u${idx}-conv-current`,
        channel: EVAL_CHANNEL,
        query: t.query,
        answer: t.answer,
        messages: [
            {role: 'system', content: '你是一个高校师生教、学助手。'},
            {role: 'user', content: t.query},
            {role: 'assistant', content: t.answer},
        ],
        insertTime: Date.now() - (windowTurnsOfSpan - i) * DAY,
    }))
}

/** 近端轮次跨度（天），保证它们都落在窗口内 */
const windowTurnsOfSpan = 6

/**
 * 沉淀事实模板：模拟数月积累下来的其它记忆。
 * 存在的意义是让"把全部事实塞进上下文"这条路按事实条数线性变贵——
 * 只有语料规模够大，才能量出召回的 token 优势；9 条事实的语料量不出来。
 */
const PAD_TOPICS = ['馆际互借', '随书资源', '数字保存', '阅读推广', '空间管理', '馆员培训', '馆藏剔旧', '学科服务']
const PAD_TEMPLATES = [
    '用户提到{t}由分管馆员牵头，季度汇报一次。',
    '用户的{t}工作以馆内台账记录为准。',
    '用户所在部门的{t}流程去年做过一次精简。',
    '用户对{t}的统计口径提出过修改意见。',
]

/**
 * @description 生成沉淀事实
 * @author xianyang
 * @param {Number} count 条数
 * @param {Number} idx 用户序号
 * @returns {Object[]} 事实
 */
function padFacts(count, idx) {
    const list = []
    for (let k = 0; k < count; k++) {
        const topic = PAD_TOPICS[k % PAD_TOPICS.length]
        list.push({
            factId: `u${idx}-pad-${k}`, topic, kind: 'fact', source: 'auto',
            confidence: 0.55 + (k % 3) * 0.1, ageDays: 30 + k * 9,
            content: PAD_TEMPLATES[k % PAD_TEMPLATES.length].replace('{t}', topic),
        })
    }
    return list
}

/**
 * @description 生成整份语料
 * @author xianyang
 * @param {Object} [params] 入参
 * @param {String} [params.runTag] 本轮运行标识，拼进 userCode 以避开上一轮的 redis 召回缓存
 * @param {Number} [params.users] 用户数上限
 * @param {Number} [params.padFacts] 每人的沉淀事实条数，用于把语料规模拉到接近真实积累量
 * @returns {Object} {users, totalFacts, totalProbes}
 */
export function buildCorpus({runTag = 'fixed', users = PROFILES.length, padFacts: pad = 0} = {}) {
    const now = Date.now()
    const list = []
    for (let idx = 0; idx < users; idx++) {
        const p = PROFILES[idx]
        const facts = [...factsOf(p, idx), ...padFacts(pad, idx)].map(f => ({
            ...f,
            userCode: `${EVAL_USER_PREFIX}-${runTag}-u${idx}`,
            channel: EVAL_CHANNEL,
            /** 相对时间必须在运行时展开，否则时间衰减会随运行日期漂移 */
            insertTime: now - f.ageDays * DAY,
        }))
        list.push({
            userCode: `${EVAL_USER_PREFIX}-${runTag}-u${idx}`,
            channel: EVAL_CHANNEL,
            profile: p,
            facts,
            windowDocs: windowTurnsOf(p, idx),
            probes: probesOf(p, idx),
        })
    }
    return {
        channel: EVAL_CHANNEL,
        users: list,
        totalFacts: list.reduce((s, u) => s + u.facts.length, 0),
        totalProbes: list.reduce((s, u) => s + u.probes.length, 0),
    }
}

/**
 * @description 按 factId 取事实
 * @author xianyang
 * @param {Object} user 用户语料
 * @param {String} factId 事实标识
 * @returns {Object|null} 事实
 */
export function findFact(user, factId) {
    return user.facts.find(f => f.factId === factId) || null
}

export default {buildCorpus, findFact, EVAL_USER_PREFIX, EVAL_CHANNEL}
