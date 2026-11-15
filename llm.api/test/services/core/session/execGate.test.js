/**
 * @fileOverview 执行器门第 1 层判据的用例（D18 四层门的"显式规则"层）
 * @module test/services/core/session/execGate
 * @description
 * 判据先行刀的"现网"就是用例。重点钉：
 * ① 空清单=合法空不是全允许（决定 1）——allow:[] 任何动作都 continue；
 * ② malformed 不许走族条件命中（决定 2）——解析不了的正文是伪装机会；按工具名可命中但警示；
 * ③ allow/deny 是终局、continue 非终局（决定 3）；
 * ④ unknown 工具永不默认放行；
 * ⑤ D18 的覆盖裁定"不只 shell"：文件写/产物上传/网络 都在动词族与暴露面里点名得到；
 * ⑥ 保险丝（第 4 层预算）：连续 escalate 与 per-run 预算两个方向都量到、关闭方向正确。
 * 词表与普查器同源（execGate import），这里钉的是"命中语义"不是词表本身。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'

const {GATE_SURFACES, VERB_FAMILIES, classifyAction, matchRule, decideLayer1, decideGateFallback} =
    await import('../../../../services/core/session/execGate.js')

describe('0 词表单源（execGate 是普查与门的共同权威）', () => {
    test('GATE_SURFACES 覆盖 D18 点名的三类：shell、文件写路径、产物上传', () => {
        const surfaces = new Set(Object.values(GATE_SURFACES))
        for (const need of ['shell', 'artifact-upload', 'network-fetch']) {
            assert.ok(surfaces.has(need), `${need} 必须在暴露面里（D18"覆盖不只 shell"的枚举面）`)
        }
    })
    test('VERB_FAMILIES 至少含 file-write/file-delete/network（沙箱代码里的危险动作族）', () => {
        const fams = VERB_FAMILIES.map((f) => f[0])
        for (const need of ['file-write', 'file-delete', 'network']) {
            assert.ok(fams.includes(need), `${need} 动词族必须在`)
        }
    })
})

describe('1 classifyAction：归一与 malformed 识别', () => {
    test('run_code + rm 命令 ⇒ shell + file-delete 族（args 用生产形态 {"code":...}——裸文本 run_code 入参不存在，v2 新规当场揪出这条假形状）', () => {
        const a = classifyAction({toolName: 'run_code', argsText: '{"code":"import os\\nos.system(\\"rm -rf /tmp/x\\")"}'})
        assert.equal(a.surface, 'shell')
        assert.ok(a.families.includes('file-delete'))
        assert.equal(a.malformed, false)
    })
    test('对象入参序列化后判族；JSON 字符串入参直判', () => {
        const obj = classifyAction({toolName: 'run_code', argsText: {code: 'requests.get("http://x")'}})
        assert.ok(obj.families.includes('network'))
        assert.ok(classifyAction({toolName: 'run_code', argsText: '{"code":"curl http://x"}'}).families.includes('network'))
    })
    test('save_artifact ⇒ artifact-upload（产物路径在门覆盖里的证据）；update_plan ⇒ plan', () => {
        assert.equal(classifyAction({toolName: 'save_artifact', argsText: '{"path":"/workspace/a"}'}).surface, 'artifact-upload')
        assert.equal(classifyAction({toolName: 'update_plan', argsText: '{}'}).surface, 'plan')
    })
    test('未列工具 ⇒ unknown（不默认放行，也不误归已知面）', () => {
        assert.equal(classifyAction({toolName: 'res-discovery_searchResMetas', argsText: '{}'}).surface, 'unknown')
    })
    test('不可序列化入参 ⇒ malformed=true 且 families 空（解析失败不许蒙混过族判）', () => {
        const circular = {}
        circular.self = circular
        const a = classifyAction({toolName: 'run_code', argsText: circular})
        assert.equal(a.malformed, true)
        assert.deepEqual(a.families, [])
    })
    test('无参元操作不算 malformed；**shell 空正文/不可解析算**（v2 硬规：读不到的动作不许进判族碰运气）；非标量算', () => {
        assert.equal(classifyAction({toolName: 'get_current_datetime'}).malformed, false)
        assert.equal(classifyAction({toolName: 'run_code', argsText: ''}).malformed, true, 'shell 空正文现在归 malformed（live 首跑分类器对空 args 判 allow 的直接教训）')
        assert.equal(classifyAction({toolName: 'run_code', argsText: 42}).malformed, true)
    })
})

describe('2 decideLayer1：命中语义与三条设计决定', () => {
    test('决定 1：allow:[] 是全 continue，不是全允许', () => {
        const r = decideLayer1(classifyAction({toolName: 'run_code', argsText: '{"code":"rm -rf /"}'}), {allow: [], deny: []})
        assert.equal(r.verdict, 'continue')
        assert.equal(r.final, false)
    })
    test('决定 3：allow 与 deny 都 final，且 deny 先查（同命 deny 赢）', () => {
        const rmRule = {id: 'rm-kill', surfaces: ['shell'], families: ['file-delete']}
        const allowAll = {id: 'yes-anything'}
        const act = classifyAction({toolName: 'run_code', argsText: '{"code":"rm x"}'})
        const r = decideLayer1(act, {allow: [allowAll], deny: [rmRule]})
        assert.equal(r.verdict, 'deny', 'allow 在前也拦不住 deny 先查')
        assert.equal(r.final, true)
        assert.equal(r.matchedRule, 'rm-kill')
    })
    test('空条件规则=显式 any（与空清单区分开）', () => {
        const r = decideLayer1(classifyAction({toolName: 'search_web', argsText: '{}'}), {allow: [{id: 'open-all'}], deny: []})
        assert.equal(r.verdict, 'allow', '一条空条件 allow 规则就是全允许——但这是写出来的，不是[]默认的')
    })
    test('决定 2：malformed 动作对"按族"的规则不匹配，但对"按工具名"的规则匹配且带警示', () => {
        const circ = {self: {}}
        circ.self = circ
        const act = classifyAction({toolName: 'run_code', argsText: circ})
        assert.equal(decideLayer1(act, {allow: [{id: 'by-family', families: ['file-write']}], deny: []}).verdict, 'continue',
            '读不懂正文就不许靠族放它过')
        const byTool = decideLayer1(act, {allow: [{id: 'shell-ok', tools: ['run_code']}], deny: []})
        assert.equal(byTool.verdict, 'allow')
        assert.match(byTool.reason, /malformed/, '按工具名放行可以，但警示必须留在 reason 里（不装看不见）')
    })
    test('规则三条件 AND：工具名+族都对上才算命中', () => {
        const r = {id: 'net-in-shell', tools: ['run_code'], families: ['network']}
        assert.equal(matchRule(classifyAction({toolName: 'run_code', argsText: '{"code":"curl x"}'}), r), true)
        assert.equal(matchRule(classifyAction({toolName: 'get_website', argsText: '{"code":"curl x"}'}), r), false, '工具不对')
        assert.equal(matchRule(classifyAction({toolName: 'run_code', argsText: '{"code":"ls"}'}), r), false, '族不对')
    })
    test('matchRule 直接传 malformed+非空families 仍不匹配族（G3 变异逼出的独立验证：守卫是公共契约的纵深，不靠 classifyAction 恰好置空）', () => {
        // matchRule 是导出 API，外部可构造这种 action；若去掉 matchRule 内的 malformed 守卫，下面会误命中
        const forced = {toolName: 'run_code', surface: 'shell', families: ['file-delete'], malformed: true}
        assert.equal(matchRule(forced, {families: ['file-delete']}), false,
            '读不懂正文就不许按族放行——即使 families 非空（这行独立钉住 matchRule 的守卫，不是 classifyAction 的副产品）')
    })
    test('按暴露面点名 artifact-upload：D18 覆盖产物路径的可表达性', () => {
        const denyUpload = {id: 'no-artifact', surfaces: ['artifact-upload']}
        const r = decideLayer1(classifyAction({toolName: 'save_artifact', argsText: '{}'}), {allow: [], deny: [denyUpload]})
        assert.equal(r.verdict, 'deny')
    })
    test('脏规则不误命中（非数组条件被忽略=当 any，但整条仍需真匹配上动作）', () => {
        assert.equal(matchRule(classifyAction({toolName: 'run_code', argsText: '{"code":"x"}'}), {tools: 'run_code'}), true,
            '非数组 tools 当缺省(any)——命中因 run_code 对 any 恒真')
        assert.equal(decideLayer1(classifyAction({toolName: 'memory_get', argsText: '{}'}), {allow: [{tools: ['run_code']}], deny: []}).verdict, 'continue')
    })
})

describe('3 decideGateFallback：第 4 层保险丝（§19 fallback:consecutive/perRun）', () => {
    test('连续 escalate 达阈值 ⇒ human；中间被 allow/deny 打断则重新计数', () => {
        assert.equal(decideGateFallback({recentVerdicts: ['escalate', 'escalate', 'escalate'], consecutive: 3}).route, 'human')
        assert.equal(decideGateFallback({recentVerdicts: ['escalate', 'allow', 'escalate', 'escalate'], consecutive: 3}).route, 'classifier',
            '末尾只 2 连，中间的 allow 断了串')
    })
    test('计数从尾不从首（G9 变异逼出的区分例：3 连后被 allow 收尾 ⇒ 尾数 0，头数会误判 human）', () => {
        const r = decideGateFallback({recentVerdicts: ['escalate', 'escalate', 'escalate', 'allow'], consecutive: 3})
        assert.equal(r.route, 'classifier', '最外层是 allow=已能裁决，不该因开头 3 连转人工')
        assert.equal(r.consecutiveEscalations, 0, '尾计数归零')
    })
    test('per-run 预算用满 ⇒ human（分类器是花钱的，兜底不能变主路）', () => {
        assert.equal(decideGateFallback({recentVerdicts: [], perRunBudget: 20, gateDecisionsThisRun: 20}).route, 'human')
        assert.equal(decideGateFallback({recentVerdicts: [], perRunBudget: 20, gateDecisionsThisRun: 19}).route, 'classifier')
    })
    test('预算优先于连续计数（两者都超 ⇒ 报预算那条）', () => {
        const r = decideGateFallback({recentVerdicts: ['escalate', 'escalate', 'escalate'], consecutive: 3, perRunBudget: 20, gateDecisionsThisRun: 25})
        assert.match(r.reason, /per-run-budget/)
    })
    test('阈值 <=0 关闭对应保险丝（不是"全部转人工"的反向误配置）', () => {
        assert.equal(decideGateFallback({recentVerdicts: ['escalate', 'escalate', 'escalate'], consecutive: 0}).route, 'classifier',
            'consecutive<=0 关掉连续闸')
        assert.equal(decideGateFallback({recentVerdicts: [], perRunBudget: 0, gateDecisionsThisRun: 999}).route, 'classifier',
            'perRunBudget<=0 关掉预算闸')
    })
    test('recentVerdicts 非数组不炸（兜底判据自己先不能是故障源）', () => {
        assert.equal(decideGateFallback({recentVerdicts: null}).route, 'classifier')
    })
})
