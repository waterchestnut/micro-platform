/**
 * @fileOverview 底座专用：classifyToolCalls 六通道的最小行为测
 * @module test/services/core/llmLoopClassifySix.base
 * @description
 * 源仓的 llmLoop.test 需要 34 个导出（含 thinking 改造产物），底座 llmLoop 尚未到那一步——整份搬会缺符号。
 * 但本批差量把 classify 升到了六通道，**新行为不能裸奔**：这里按源仓同款用例（互斥/取反串/兼容）做子集复刻。
 * llmChat/thinking 接线批把源版全量测试带进来后，本文件即可退役（名字里带着 mission）。
 */
import { test } from 'node:test'
import * as assert from 'node:assert'
import { classifyToolCalls } from '../../../services/core/llmLoop.js'

const PREDS = {
    isMemoryTool: (n) => String(n).startsWith('memory_'),
    isOverflowTool: (n) => n === 'read_tool_result',
    isCodeTool: (n) => n === 'run_code',
    isPlanTool: (n) => n === 'update_plan',
    isArtifactTool: (n) => n === 'save_artifact' || n === 'read_artifact',
}

test('classifyToolCalls：六类互斥且并集完整（源仓同款口径）', () => {
    const calls = [
        {id: '1', function: {name: 'memory_save'}},
        {id: '2', function: {name: 'memory_search'}},
        {id: '3', function: {name: 'read_tool_result'}},
        {id: '4', function: {name: 'run_code'}},
        {id: '5', function: {name: 'update_plan'}},
        {id: '6', function: {name: 'save_artifact'}},
        {id: '7', function: {name: 'read_artifact'}},
        {id: '8', function: {name: 'searxng_http/search'}},
    ]
    const r = classifyToolCalls(calls, PREDS)
    assert.equal(r.memoryCalls.length, 2)
    assert.equal(r.overflowCalls.length, 1)
    assert.equal(r.codeCalls.length, 1)
    assert.equal(r.planCalls.length, 1)
    assert.equal(r.artifactCalls.length, 2)
    assert.equal(r.otherCalls.length, 1)
    const total = ['memoryCalls', 'overflowCalls', 'codeCalls', 'planCalls', 'artifactCalls', 'otherCalls']
        .reduce((s, k) => s + r[k].length, 0)
    assert.equal(total, calls.length, '不能有调用被丢掉，也不能被算两次')
})

test('classifyToolCalls：plan/artifact 绝不漏进 otherCalls（取反串必须含它们）', () => {
    for (const name of ['update_plan', 'save_artifact', 'read_artifact']) {
        const r = classifyToolCalls([{id: '1', function: {name}}], PREDS)
        assert.equal(r.otherCalls.length, 0, `${name} 被当成 MCP 工具丢给别的通道了`)
    }
})

test('classifyToolCalls：不传 plan/artifact 谓词 ⇒ 行为与四类时代逐字一致（兼容保险）', () => {
    const calls = [
        {id: '1', function: {name: 'memory_save'}},
        {id: '2', function: {name: 'update_plan'}},
        {id: '3', function: {name: 'save_artifact'}},
        {id: '4', function: {name: 'other.tool'}},
    ]
    const r = classifyToolCalls(calls, {isMemoryTool: PREDS.isMemoryTool, isOverflowTool: PREDS.isOverflowTool, isCodeTool: PREDS.isCodeTool})
    assert.equal(r.planCalls.length, 0)
    assert.equal(r.artifactCalls.length, 0)
    assert.equal(r.otherCalls.length, 3, '没有谓词时这些名字必须原样走老路（进 other），不是凭空消失')
})
