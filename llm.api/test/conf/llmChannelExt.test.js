/**
 * @fileOverview llmChannel 启动扩展层单测（覆盖/注入/深合并/数组替换/null 删/sysPromptFile/零变化）
 * @module test/conf/llmChannelExt
 */
import {describe, test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {deepMergeChannel, loadChannelExtensions, applyChannelExtensions} from '../../conf/llmChannel.js'

describe('deepMergeChannel', () => {
    test('嵌套深合并：只覆盖写了的字段，其余继承 base', () => {
        const base = {sysPrompt: 'a', memory: {enabled: false, capture: false, recall: false}}
        const out = deepMergeChannel(base, {memory: {recall: true}})
        assert.equal(out.sysPrompt, 'a')
        assert.deepEqual(out.memory, {enabled: false, capture: false, recall: true})
    })
    test('数组整值替换（不逐元素合并）', () => {
        const out = deepMergeChannel({skillNames: ['a', 'b', 'c']}, {skillNames: ['z']})
        assert.deepEqual(out.skillNames, ['z'])
    })
    test('null 显式删除键', () => {
        const out = deepMergeChannel({a: 1, b: 2}, {b: null})
        assert.equal('b' in out, false)
        assert.equal(out.a, 1)
    })
    test('base 缺省时按 ext 成型（注入新频道）', () => {
        const out = deepMergeChannel(undefined, {sysPrompt: 'new', enableMcp: false})
        assert.deepEqual(out, {sysPrompt: 'new', enableMcp: false})
    })
    test('不改 base 原对象（返回副本）', () => {
        const base = {a: 1, n: {x: 1}}
        deepMergeChannel(base, {n: {y: 2}, z: 3})
        assert.deepEqual(base, {a: 1, n: {x: 1}})
    })
})

describe('applyChannelExtensions', () => {
    test('注入新频道（base 无该 key）', () => {
        const base = {ch1: {sysPrompt: 'a'}}
        applyChannelExtensions(base, {LLM_CHANNEL_EXT_JSON: JSON.stringify({ch2: {sysPrompt: 'b'}})})
        assert.equal(base.ch2.sysPrompt, 'b')
        assert.equal(base.ch1.sysPrompt, 'a') // 原频道不动
    })
    test('覆盖既有频道的部分字段、深合并保留其余', () => {
        const base = {ch1: {sysPrompt: 'a', memory: {enabled: false, capture: false}, maxIterations: 6}}
        applyChannelExtensions(base, {LLM_CHANNEL_EXT_JSON: JSON.stringify({ch1: {memory: {enabled: true}}})})
        assert.equal(base.ch1.sysPrompt, 'a')
        assert.equal(base.ch1.maxIterations, 6)
        assert.deepEqual(base.ch1.memory, {enabled: true, capture: false})
    })
    test('两个 env 都不配 ⇒ 零变化（键集不变、对象不被替换）', () => {
        const base = {ch1: {sysPrompt: 'a'}, ch2: {sysPrompt: 'b'}}
        const before = JSON.stringify(base)
        applyChannelExtensions(base, {})
        assert.equal(JSON.stringify(base), before)
    })
    test('文件 + 内联叠加：内联优先级高于文件（base<文件<内联）', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chan-'))
        const fp = path.join(dir, 'ch.json')
        fs.writeFileSync(fp, JSON.stringify({chX: {sysPrompt: 'from-file', memory: {enabled: true}}}))
        try {
            const base = {}
            applyChannelExtensions(base, {LLM_CHANNEL_EXT_PATH: fp, LLM_CHANNEL_EXT_JSON: JSON.stringify({chX: {memory: {recall: true}}})})
            assert.equal(base.chX.sysPrompt, 'from-file')      // 文件给的保留
            assert.deepEqual(base.chX.memory, {enabled: true, recall: true}) // 文件+内联深合并
        } finally {
            fs.rmSync(dir, {recursive: true, force: true})
        }
    })
    test('sysPromptFile 相对 JSON 文件目录解析成 sysPrompt', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chan-'))
        fs.writeFileSync(path.join(dir, 'p.txt'), '  外部提示词  ')
        const fp = path.join(dir, 'ch.json')
        fs.writeFileSync(fp, JSON.stringify({chY: {sysPromptFile: 'p.txt', enableMcp: false}}))
        try {
            const base = {}
            applyChannelExtensions(base, {LLM_CHANNEL_EXT_PATH: fp})
            assert.equal(base.chY.sysPrompt, '外部提示词') // trim 生效
            assert.equal('sysPromptFile' in base.chY, false) // 辅助键已移除
        } finally {
            fs.rmSync(dir, {recursive: true, force: true})
        }
    })
    test('坏 JSON 不炸（解析失败仅告警、base 不变）', () => {
        const base = {ch1: {sysPrompt: 'a'}}
        applyChannelExtensions(base, {LLM_CHANNEL_EXT_JSON: '{not json'})
        assert.equal(base.ch1.sysPrompt, 'a')
        assert.equal(Object.keys(base).length, 1)
    })
})

describe('loadChannelExtensions', () => {
    test('无 env 返回空', () => {
        assert.deepEqual(loadChannelExtensions({}), {})
    })
})
