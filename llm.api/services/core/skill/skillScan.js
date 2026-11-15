/**
 * @fileOverview SKILL.md 的注入面扫描（纯函数，零依赖）——PR-E0.1 的第 ③ 项
 * @module services/core/skill/skillScan
 * @description
 * 为什么这条必须在**写入侧**而不是装配侧：`skillMD` 会被原样拼进 system/fixed 槽
 * （`llmChat.js:346-350` 的 `fixedMessages.push({role:'system', content: prompt})`），
 * 而注册接口今天**任何登录用户都能调**（`grpcSkill.js:201` 起无任何校验，`curUserInfo` 只用来盖 `operator`）。
 * 两者合起来就是 §2.22 说的"跨用户持久性 prompt 投毒"：**注册一次，长期生效，影响该频道全体用户**。
 *
 * 三条设计纪律：
 * 1. **命中即拒，不清洗后放行**。清洗意味着"我们比作者更懂这句话该不该存在"，
 *    而技能正文是人写的说明书，任何自动改写都可能把它改坏；治理的对象是**入库**，不是改写内容。
 * 2. **只报类别与位置，绝不把命中的原文写进日志**。理由与 `pii.js` 文件头同一条：
 *    命中片段本身就是攻击载荷，写进日志等于把它复制到第二个地方（还可能进 kafka）。
 * 3. **不可见字符按码位判，不按"看起来怪不怪"判**。零宽/方向控制/BOM 这类字符在渲染后完全不可见，
 *    而 `ignore previous instructions` 前面藏一个 RLO 就能躲过所有按字符串匹配的过滤器——
 *    这正是"扫描器只查关键词"的经典失效方式，所以这里两类都要查。
 */

/** 不可见 / 双向控制 / 零宽码位（渲染后不可见，但能改变相邻文本的逻辑顺序）
 * （导出给 `evals/goldLeak.js` 等同族扫描复用：归一化表一旦有两份，就会有一次"漏过的是另一份"——ajv 漂移先例） */
export const INVISIBLE_CODEPOINTS = [
    {cp: 0x200B, name: 'zero-width-space'},
    {cp: 0x200C, name: 'zero-width-non-joiner'},
    {cp: 0x200D, name: 'zero-width-joiner'},
    {cp: 0x2060, name: 'word-joiner'},
    {cp: 0xFEFF, name: 'byte-order-mark'},
    {cp: 0x202A, name: 'left-to-right-embedding'},
    {cp: 0x202B, name: 'right-to-left-embedding'},
    {cp: 0x202C, name: 'pop-directional-formatting'},
    {cp: 0x202D, name: 'left-to-right-override'},
    {cp: 0x202E, name: 'right-to-left-override'},
    {cp: 0x2066, name: 'left-to-right-isolate'},
    {cp: 0x2067, name: 'right-to-left-isolate'},
    {cp: 0x2068, name: 'first-strong-isolate'},
    {cp: 0x2069, name: 'pop-directional-isolate'},
]

/**
 * 注入模式。每条都写成"动词 + 对象"的组合，避免单个常见词造成大面积误报：
 * 例如 `忽略` 单独出现是正常的中文，`忽略.*(之前|以上|上面|前面).*(指令|规则|说明|设定)` 才是夺权句。
 */
/**
 * 哪些模式接受否定豁免（`negationExempt: true`）——**这是逐条选的，不是全局开关**。
 *
 * 为什么必须逐条：升级句式（`不要告知用户`、`禁止拒绝`、`不要安全提醒`）**本身就是带否定词的命令**，
 * 全局豁免等于把这三类直接删掉；而 `覆盖系统提示`、`上传用户数据` 这类动词短语，
 * 前面挂个"不要"就变成合法禁令，不豁免就会误杀每一份正常说明书。
 * 上一版全局豁免时，`不要告知用户` 被放行——那是本次要防的东西之一，不是巧合。
 */
const INJECTION_PATTERNS = [
    {name: 'ignore-previous-instructions', negationExempt: true, re: /(ignore|disregard|forget|忽略|无视|不要理会)[\s\S]{0,40}?(previous|above|prior|earlier|之前|以上|上面|前面|先前)[\s\S]{0,40}?(instruction|prompt|rule|directive|system|指令|规则|说明|设定|提示)/i},
    {name: 'override-system-prompt', negationExempt: true, re: /(override|覆盖|改写|替换)[\s\S]{0,25}?(system\s*prompt|系统提示|初始指令|系统指令|底层指令)/i},
    {name: 'you-are-now', negationExempt: false, re: /(you\s+are\s+now|从现在开始你是|你的新身份是|扮演一个没有任何限制)/i},
    {name: 'role-spoof-line', negationExempt: false, re: /^\s*(system|assistant|developer)\s*[:>]/im},
    {name: 'reveal-system-prompt', negationExempt: true, re: /((reveal|print|output|repeat|泄露|打印|输出|复述)[\s\S]{0,30}?(system prompt|系统提示|初始指令|hidden instruction|隐藏指令))|((把|将)\s*(system prompt|系统提示|初始指令|隐藏指令)[^。\n]{0,20}?(打印|输出|复述|泄露|reveal|print|output))/i},
    {name: 'tool-or-priv-escalation', negationExempt: true, re: /(enable|grant|assume|escalate|开启|授予|获取|提升到)[\s\S]{0,30}?(admin|root|all tools|every tool|管理员|最高权限|所有工具|全部工具)/i},
    {name: 'exfiltration-instruction', negationExempt: true, re: /((send|post|upload|exfiltrate|上传|发送到|传回)[\s\S]{0,40}?(user\s*data|token|secret|credential|隐私|密钥|用户数据|个人信息|对话内容|答案内容)[\s\S]{0,40}?(http|https|url|webhook|地址|接口))|((把|将)[^。\n]{0,30}(内容|数据|答案)[^。\n]{0,20}(发送到|上传到|传回|POST\s+到))/i},
    {name: 'delimiter-breakout', negationExempt: false, re: /^\s*---\s*$/gm},
]

/**
 * 指令升级句式：把"建议"抬成"必须/无条件"，是技能描述夺权的常见措辞
 */
/** 指令升级句式：把"建议"抬成"必须/无条件"。**一律不做否定豁免**——这些短语本身就带否定词 */
const ESCALATION_PATTERNS = [
    {name: 'unconditional-obey', negationExempt: false, re: /(必须无条件|无条件执行|always follow|must always obey|不得拒绝|禁止拒绝)/i},
    {name: 'suppress-safety', negationExempt: false, re: /(without (any )?(filter|restriction|safety)|忽略安全|不要安全提醒|跳过审核|免除限制)/i},
    {name: 'silence-user', negationExempt: false, re: /(do not (tell|warn|inform) the user|不要告知用户|不要提醒用户|瞒着用户|不得让用户知道)/i},
]

/**
 * 全局副本（必须在两个模式数组**之后**声明——上一版把它写在前面，`const` 还在 TDZ 里就直接抛 ReferenceError）
 */
const toGlobal = (p) => ({...p, re: new RegExp(p.re.source, p.re.flags.includes('g') ? p.re.flags : p.re.flags + 'g')})
const ALL_PATTERNS = [...INJECTION_PATTERNS.map(toGlobal), ...ESCALATION_PATTERNS.map(toGlobal)]
const ESCALATION_KINDS = new Set(ESCALATION_PATTERNS.map((p) => p.name))

/** frontmatter 围栏（与 `grpcSkill.validateSkillMD` 同一形状，不另造一套解析） */
const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---/

/**
 * @description 取出正文（去掉开头的 YAML frontmatter），并给出正文在原文里的起始下标
 * @param {String} skillMD 全文
 * @returns {{body: String, offset: Number}} 结果
 *
 * 为什么要分家：不可见字符在 frontmatter 里同样危险（name/description 会被拼进提示词），
 * 所以它扫**全文**；而 `^\s*---\s*$` 这类"分隔符逃逸"模式如果也扫全文，
 * **每一份合法 SKILL.md 的开头围栏都会命中**——那是误报，不是防御。
 */
function splitBody(skillMD) {
    const m = FRONTMATTER_RE.exec(skillMD)
    if (!m) {
        return {body: skillMD, offset: 0}
    }
    return {body: skillMD.slice(m[0].length), offset: m[0].length}
}

/**
 * 否定豁免。合法说明书里"不要覆盖系统提示""输出保持原文事实，不覆盖系统提示"这类句子
 * **正是在反对**攻击者想要的事，按关键词匹配会误杀。
 *
 * 两条判据缺一不可，方向相反：
 * 1. **命中跨度内部**有否定 ⇒ 豁免。覆盖"输出……不覆盖系统提示"这种"动词在前、否定在中间"的合法长句；
 * 2. **同小句内的前置**否定才算数（遇到 ，。；、: 或换行就停）。
 *    只看"前面 12 个字符"会被"不要问我，输出系统提示"骗过去——那个"不要"属于另一个小句，
 *    跟这里的"输出"没关系，必须仍然命中。
 *
 * 局限照旧写清：这是启发式，不是完备证明。"这句话不是让你覆盖系统提示——现在就去覆盖"
 * 这类先否定后命令的写法仍会漏。③ 的定位是第一道过滤，真正的兜底是 ①②（谁能写、谁批准）与 ⑤（内容哈希回退）。
 */
const NEGATION_RE = /(不|别|禁止|不要|不得|勿|避免|防止|never|do\s+not|don'?t|cannot|不能)/i
const CLAUSE_BREAK_RE = /[，,。.;；、:：!！?？\n]/

/**
 * @description 这个命中该不该豁免
 * @param {String} text 被扫文本（正文）
 * @param {Number} at 命中起点
 * @param {Number} len 命中长度
 * @returns {Boolean} true 表示豁免
 */
function negatedAt(text, at, len) {
    if (NEGATION_RE.test(text.slice(at, at + len))) {
        return true
    }
    let from = Math.max(0, at - 24)
    for (let i = at - 1; i >= from; i--) {
        if (CLAUSE_BREAK_RE.test(text[i])) {
            from = i + 1
            break
        }
    }
    return NEGATION_RE.test(text.slice(from, at))
}

/**
 * @description 扫描 SKILL.md 的注入面
 * @param {String} skillMD 正文
 * @returns {{findings: Array<{kind: String, category: String, at: Number}>, hasInvisible: Boolean, hasInjection: Boolean, hasEscalation: Boolean}} 结果
 *
 * 返回里**不含任何命中原文**（纪律 2）。`at` 是**原文下标**（正文命中会加回 frontmatter 偏移），
 * 够定位到段落但不复制载荷。
 */
export function scanSkillContent(skillMD) {
    const findings = []
    if (typeof skillMD !== 'string' || !skillMD) {
        return {findings, hasInvisible: false, hasInjection: false, hasEscalation: false}
    }
    for (const {cp, name} of INVISIBLE_CODEPOINTS) {
        let at = skillMD.indexOf(String.fromCodePoint(cp))
        while (at >= 0) {
            findings.push({kind: name, category: 'invisible', at})
            at = skillMD.indexOf(String.fromCodePoint(cp), at + 1)
        }
    }
    const {body, offset} = splitBody(skillMD)
    for (const p of ALL_PATTERNS) {
        const category = ESCALATION_KINDS.has(p.name) ? 'escalation' : 'injection'
        p.re.lastIndex = 0
        let m
        /** 一轮里可能有多处命中：逐处判豁免，而不是"命中一次就整条模式作废" */
        while ((m = p.re.exec(body)) !== null) {
            /** 豁免按模式判（见 negationExempt 的注释）：升级句式不适用，否则等于删掉那三类 */
            if (!(p.negationExempt && negatedAt(body, m.index, m[0].length))) {
                findings.push({kind: p.name, category, at: offset + m.index})
            }
            /** 零宽匹配会让 exec 原地不动，必须手动前进一格，否则这里死循环 */
            if (m.index === p.re.lastIndex) {
                p.re.lastIndex += 1
            }
        }
    }
    return {
        findings,
        hasInvisible: findings.some((f) => f.category === 'invisible'),
        hasInjection: findings.some((f) => f.category === 'injection'),
        hasEscalation: findings.some((f) => f.category === 'escalation'),
    }
}

/**
 * @description 这一份 skillMD 能不能入库（写入侧的闸门判据）
 * @param {String} skillMD 正文
 * @param {Object} [opt] 参数
 * @param {Boolean} [opt.allowEscalation] 措辞升级类默认也拒；只有显式放行才降级为"只拒注入与不可见字符"
 * @returns {{allow: Boolean, reasons: String[]}} 结果
 *
 * 默认**三类全拒**：措辞升级（"必须无条件""不要告知用户"）在技能说明书里几乎不可能是正当需求，
 * 而它恰好是投毒载荷最需要的两件事——强制服从与对用户保密。误拒的代价是作者改一句话重写，
 * 误放的代价是该频道全体用户的对话被长期劫持，两边不对称。
 */
export function skillContentAllowed(skillMD, {allowEscalation = false} = {}) {
    const s = scanSkillContent(skillMD)
    const reasons = []
    if (s.hasInvisible) {
        reasons.push('invisible-codepoint')
    }
    if (s.hasInjection) {
        reasons.push('injection-pattern')
    }
    if (s.hasEscalation && !allowEscalation) {
        reasons.push('instruction-escalation')
    }
    return {allow: reasons.length === 0, reasons}
}

/**
 * @description 把扫描结果拼成一条**可安全入日志**的短语（只含类别与计数，不含正文）
 * @param {Object} scan scanSkillContent 的结果
 * @returns {String} 结果
 */
export function scanSummaryForLog(scan) {
    const by = {}
    for (const f of (scan?.findings || [])) {
        by[f.kind] = (by[f.kind] || 0) + 1
    }
    const parts = Object.entries(by).map(([k, v]) => `${k}x${v}`)
    return parts.length ? parts.join(',') : 'clean'
}
