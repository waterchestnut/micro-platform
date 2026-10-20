import { test } from 'node:test'
import * as assert from 'node:assert'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.resolve(__dirname, '../..')

/* skill 模块在加载期读 llm.logger / llm.config，先注入最小全局再动态导入 */
global.llm = global.llm || {
    baseDir: srcDir + path.sep,
    logger: {info() {}, warn() {}, error() {}},
    config: {
        debug: false,
        sandboxConfig: {
            skillExecMode: 'sandbox',
            skillCaps: {'document-extractor': ['extract'], 'pure-math': []},
        },
    },
    tools: {},
}

/* 只导入 provider（它仅读 llm.logger/config）；skillManager/skillChat 会连带加载 daos → 需要 Mongo，离线测试不碰 */
const {buildSkillExecArgs} = await import('../../skill/providers/localSkillProvider.js')

test('buildSkillExecArgs 把会话与按 skill 登记的能力带给沙箱', () => {
    const a = buildSkillExecArgs({
        skill: {name: 'document-extractor'},
        command: {name: 'extractFromPdf'},
        parameters: {url: 'http://x/a.pdf'},
        execOptions: {conversationCode: 'conv-1'},
        scriptText: 'export async function executeCommand(){}',
        sandboxConfig: {skillCaps: {'document-extractor': ['extract']}},
    })
    assert.equal(a.conversationCode, 'conv-1')
    assert.deepEqual(a.caps, ['extract'])
    assert.equal(a.skillName, 'document-extractor')
    assert.equal(a.commandName, 'extractFromPdf')

    /* 没登记能力的 skill 只能拿到空数组，不能默认全量 */
    const b = buildSkillExecArgs({
        skill: {name: 'unknown-skill'}, command: {name: 'go'}, parameters: {},
        execOptions: {}, scriptText: '', sandboxConfig: {skillCaps: {'document-extractor': ['extract']}},
    })
    assert.deepEqual(b.caps, [])
    assert.equal(b.conversationCode, '')
})

test('sandboxConfig 缺省时组装参数不炸，能力为空、会话为空串', () => {
    const a = buildSkillExecArgs({
        skill: {name: 'demo'}, command: {name: 'go'}, parameters: {}, execOptions: undefined, scriptText: 'x',
    })
    assert.deepEqual(a.caps, [])
    assert.equal(a.conversationCode, '')
    assert.equal(a.commandName, 'go')
})
