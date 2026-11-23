/**
 * @fileOverview PR-E0.1 的接线守卫：判据存在 ≠ 判据被调用
 * @module test/services/core/skillGovernanceWiring
 * @description
 * 本仓已经三次栽在"两侧不齐"上：`runOverlap`/`regeneratedFrom` 在上游算好了但装配清单没列（库里没字段）、
 * meta 与 provider 只改一侧（提示不出现）、`allowsAnswerCache` 有测试但链路没调用（绕缓存落空）。
 * 这次新增的两个纯模块（治理判据 + 注入扫描）用例很全，**但用例全绿只证明判据本身对**，
 * 不证明请求路径经过它们。所以这里逐条断言"服务层确实调了它"。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

/** 本文件在 src/test/services/core/ ⇒ 回到 src 需要上跳三级 */
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
/** 去注释后再断言：判据名字出现在注释里不算被调用（上一轮踩过这个反例） */
function code(rel) {
    return fs.readFileSync(path.join(SRC, rel), 'utf8')
        .replace(/\r/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
}

describe('1 五个写入口都必须过权限闸门', () => {
    const svc = code('services/core/grpcSkill.js')
    const fns = {
        addGrpcSkill: 'SKILL_ACTIONS.ADD',
        updateGrpcSkill: 'SKILL_ACTIONS.UPDATE',
        deleteGrpcSkill: 'SKILL_ACTIONS.DELETE',
        enableGrpcSkill: 'SKILL_ACTIONS.ENABLE',
        disableGrpcSkill: 'SKILL_ACTIONS.DISABLE',
    }
    for (const [fn, action] of Object.entries(fns)) {
        test(`${fn} 调用 authorizeSkillWrite(${action})`, () => {
            const at = svc.indexOf(`export async function ${fn}(`)
            assert.ok(at >= 0, `找不到 ${fn}`)
            const end = svc.indexOf('\nexport ', at + 10)
            const body = svc.slice(at, end > 0 ? end : svc.length)
            assert.match(body, /authorizeSkillWrite\(/, `${fn} 没有权限闸门 ⇒ 任何登录用户都能改`)
            assert.match(body, new RegExp(action.replace('.', '\\.')), `${fn} 传的 action 不是 ${action}`)
        })
        /** 留痕单独一条：上一版把 authorize 与 journal 塞在同一条断言里，
         *  变异拆掉 writeJournal 时红的是"权限闸门"那条标题，读日志的人会以为权限坏了——断言要能指认病因 */
        test(`${fn} 写留痕（⑦）`, () => {
            const at = svc.indexOf(`export async function ${fn}(`)
            const end = svc.indexOf('\nexport ', at + 10)
            const body = svc.slice(at, end > 0 ? end : svc.length)
            assert.match(body, /await writeJournal\(\{/, `${fn} 没有留痕`)
        })
    }
    test('reviewGrpcSkill 用 decideReviewTransition（作者不能自批那条）', () => {
        const at = svc.indexOf('export async function reviewGrpcSkill(')
        const body = svc.slice(at, svc.indexOf('\nexport ', at + 10) > 0 ? svc.indexOf('\nexport ', at + 10) : svc.length)
        assert.match(body, /decideReviewTransition\(/)
        assert.match(body, /writeJournal\(/)
    })
    /**
     * 顺序断言，不是风格断言：上一版 review 先 `getByCode` 再判权限，
     * 实测非管理员拿到的是 500/存在性反馈 —— 状态码差本身就成了"这个 skillCode 存在吗"的预言机。
     */
    test('review 里权限判定必须早于"技能不存在"分支', () => {
        const at = svc.indexOf('export async function reviewGrpcSkill(')
        const body = svc.slice(at, at + 3000)
        const authAt = body.indexOf('decideReviewTransition(')
        const notFoundAt = body.indexOf('要审核的技能不存在')
        assert.ok(authAt >= 0 && notFoundAt >= 0, '两个分支都得在')
        assert.ok(authAt < notFoundAt, '先查库再判权限 ⇒ 陌生人可用状态码探测技能是否存在')
    })
})

describe('2 内容闸门（③④）真的接在写入口上', () => {
    const svc = code('services/core/grpcSkill.js')
    for (const fn of ['addGrpcSkill', 'updateGrpcSkill']) {
        test(`${fn} 调用 assertContentGovernance`, () => {
            const at = svc.indexOf(`export async function ${fn}(`)
            const body = svc.slice(at, svc.indexOf('\nexport ', at + 10) > 0 ? svc.indexOf('\nexport ', at + 10) : svc.length)
            assert.match(body, /assertContentGovernance\(/, `${fn} 没接内容闸门 ⇒ 主机白名单与注入扫描形同虚设`)
        })
    }
    test('assertContentGovernance 内部两件事都做了：hostAllowed 与 skillContentAllowed', () => {
        const at = svc.indexOf('export function assertContentGovernance(')
        const body = svc.slice(at, at + 2000)
        assert.match(body, /hostAllowed\(/)
        assert.match(body, /skillContentAllowed\(/)
    })
})

describe('3 装配侧（②⑤）：批准 + 哈希两道闸都在取清单处', () => {
    const svc = code('services/core/grpcSkill.js')
    const at = svc.indexOf('export async function getGrpcSkillsByChannel(')
    const body = svc.slice(at, svc.indexOf('\nexport ', at + 10) > 0 ? svc.indexOf('\nexport ', at + 10) : svc.length)
    test('清单过滤走 skillEligibleForAssembly（不写散落的 if）', () => {
        assert.ok(at > 0, '找不到装配函数')
        assert.match(body, /skillEligibleForAssembly\(/, '装配没判审核态 ⇒ 未批准的技能照样进上下文')
    })
    /**
     * 断言的是"在受配置控制的分支里被调用"，不是"这个函数名出现过"。
     * 上一版只断言名字出现，于是把 `if (p.hashCheckEnabled)` 改成 `if (false)` 之后守卫照样绿——
     * 那正是我在别处批评过的恒真式断言（变异测试 E3 把它抓了出来）。
     */
    test('装配做内容哈希核对，且这条核对受配置开关控制（不是写着但走不到）', () => {
        assert.match(body, /if \(p\.hashCheckEnabled\)[\s\S]{0,400}?checkContentHash\(/,
            '哈希核对不在受开关控制的分支里 ⇒ 关掉开关就等于不做核对')
        assert.match(body, /md5\(/)
    })
    test('审核态过滤在条件分支里生效（不是只 import 了判据）', () => {
        assert.match(body, /if \(!skillEligibleForAssembly\(row\)\)/,
            '审核态判定没有作为过滤条件 ⇒ 未批准的技能照样进上下文')
    })
    test('不一致时打回 pending 并留痕（不是只在内存里剔除）', () => {
        assert.match(body, /reviewStatus:\s*SKILL_REVIEW\.PENDING/)
        assert.match(body, /op:\s*'auto-pending'/)
    })
    test('enable 也要看审核态（否则"启用"就是批准旁路）', () => {
        const en = svc.indexOf('export async function enableGrpcSkill(')
        const enBody = svc.slice(en, svc.indexOf('\nexport ', en + 10) > 0 ? svc.indexOf('\nexport ', en + 10) : svc.length)
        /** 同样断言"作为条件存在"，而不是"名字出现过" */
        assert.match(enBody, /if \(!skillEligibleForAssembly\(currentSkill\)\)/,
            'enable 不看审核态 ⇒ 注册(pending) 后直接启用就绕过了批准，治理变成走形式')
    })
})

describe('4 配置面：判据读的键必须声明（同 cronKeysDeclared 那条先例）', () => {
    const cfg = code('conf/system.config.js')
    const svc = code('services/core/grpcSkill.js')
    const keys = ['adminUserCodes', 'privCodes', 'allowedHosts', 'enforce', 'scanEnabled', 'allowEscalationPhrasing', 'hashCheckEnabled']
    for (const k of keys) {
        test(`grpcSkill.${k} 在配置里有声明`, () => {
            assert.ok(new RegExp(`grpcSkill[\\s\\S]{0,1200}?${k}:`).test(cfg), `system.config.js 里没有 grpcSkill.${k}`)
        })
    }
    test('服务层读的是同一组键名（不出现配置里没有的键）', () => {
        const at = svc.indexOf('function governancePolicy()')
        /** 按函数边界切：上一版切固定长度，越界抓到下一个函数的 `c.` 变量，报出一个不存在的"未声明键" */
        const end = svc.indexOf('\n}', at + 10)
        assert.ok(at > 0 && end > at, '找不到 governancePolicy 的边界')
        const body = svc.slice(at, end)
        const read = [...body.matchAll(/c\.([A-Za-z]+)/g)].map((m) => m[1])
        assert.ok(read.length >= keys.length, `只读到 ${read.length} 个键，解析边界可能又切短了`)
        for (const k of read) {
            assert.ok(keys.includes(k), `服务层读了未声明的键 ${k}（配置面与判据面分家）`)
        }
    })
})

describe('5 留痕面：审计表不写正文', () => {
    const svc = code('services/core/grpcSkill.js')
    test('summarizeSkillForJournal 只带哈希与长度，不带 skillMD 原文', () => {
        const at = svc.indexOf('export function summarizeSkillForJournal(')
        const body = svc.slice(at, at + 1200)
        assert.match(body, /skillMDChars/)
        assert.ok(!/skillMD:\s*skill\.skillMD/.test(body), '审计摘要里塞了正文：多一处需要脱敏的地方')
    })
    test('留痕失败不阻断主操作，但必须 error 级可见', () => {
        const at = svc.indexOf('async function writeJournal(')
        const body = svc.slice(at, at + 900)
        assert.match(body, /logger\.error\(/)
        assert.ok(!/throw/.test(body.split('catch')[1] || ''), '留痕写失败还往外抛 ⇒ 会把已成功的操作报成失败')
    })
})

describe('6 乙全目录：guide 条目形状与装配分流（guide 只进目录、不进可调用候选）', () => {
    const svc = code('services/core/grpcSkill.js')
    const prov = code('skill/providers/grpcSkillProvider.js')

    test('assertContentGovernance 支持 skipHost（guide 无后端跳白名单，注入扫描仍跑）', () => {
        const at = svc.indexOf('export function assertContentGovernance(')
        const body = svc.slice(at, at + 1200)
        assert.match(body, /skipHost\s*=\s*false/, '没有 skipHost 选项 ⇒ guide 条目无法免 host')
        assert.match(body, /if \(!skipHost\)[\s\S]{0,200}?hostAllowed\(/, 'host 检查没被 skipHost 包住 ⇒ guide 仍被白名单拒')
        assert.match(body, /skillContentAllowed\(/, '注入扫描不能被 skipHost 一起旁路（guide 正文同样要扫）')
    })
    test('reconcile 预检按档分流：guide 要 entry.url、read/write 要 grpcHost', () => {
        const at = svc.indexOf('export async function reconcileManifest(')
        const body = svc.slice(at, at + 3000)
        assert.match(body, /ec === 'guide'[\s\S]{0,120}?entry\.url/, 'guide 条目没要求 entry.url ⇒ 会灌进无入口的死 guide')
        assert.match(body, /skipHost:\s*ec === 'guide'/, 'guide 没走 skipHost ⇒ 无 host 的 guide 被白名单拒')
    })
    test('grpcSkillProvider 用 grpcHost 有无分流（guide 不进可调用候选）', () => {
        assert.match(prov, /item\.skillMD && item\.grpcHost/,
            'provider 没按 grpcHost 过滤 ⇒ guide 行会被当可调用技能候选（无 per-user 过滤，泄露无权限功能）')
    })
    test('add 落库补 effectClass（不吃 schema 的 guide 默认，可调用散件不被误标 guide）', () => {
        const at = svc.indexOf('export async function addGrpcSkill(')
        const body = svc.slice(at, svc.indexOf('\nexport ', at + 10) > 0 ? svc.indexOf('\nexport ', at + 10) : svc.length)
        assert.match(body, /effectClass:\s*grpcSkillInfo\.effectClass \|\| 'read'/, 'add 不设 effectClass ⇒ 可调用散件吃 schema 默认 guide')
    })
})
