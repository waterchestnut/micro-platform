/**
 * @fileOverview 频道档位声明与选档优先级的约束（conf/llmChannel.js + conf/llmModel.js）
 */
import {test} from 'node:test'
import assert from 'node:assert/strict'
import llmChannelDataSet, {getConfiguredChannels, validateChannelModels} from '../../conf/llmChannel.js'
import {
    relayModels,
    pickModelKey,
    resolveModelKey,
    defaultModelKey,
    defaultVisionModelKey,
} from '../../conf/llmModel.js'

test('每个频道都显式声明 model 与 visionModel，且档位有效', () => {
    assert.deepEqual(validateChannelModels(), [], '频道档位声明应全部有效')
    for (const channel of getConfiguredChannels()) {
        const cfg = llmChannelDataSet[channel]
        assert.ok(cfg.model && relayModels[cfg.model], `${channel} 应声明有效 model`)
        assert.ok(cfg.visionModel && relayModels[cfg.visionModel], `${channel} 应声明有效 visionModel`)
        assert.ok(relayModels[cfg.visionModel].vision, `${channel}.visionModel 必须是视觉族`)
    }
})

test('不同频道按用途分档，不共用一个默认值', () => {
    const models = getConfiguredChannels().map(c => llmChannelDataSet[c].model)
    assert.ok(new Set(models).size > 1, '至少要有两个频道使用不同档位，否则分级无意义')
})

test('选档优先级：请求 > 频道声明 > 全局默认', () => {
    const channelConfig = {model: 'relay_qwen_pro', visionModel: 'relay_qwen_vl_flash'}
    assert.equal(
        pickModelKey({llmModel: 'relay_deepseek_low', channelConfig}),
        'relay_deepseek_low',
        '请求显式指定时最优先',
    )
    assert.equal(pickModelKey({channelConfig}), 'relay_qwen_pro', '缺省用频道的文本档')
    assert.equal(pickModelKey({}), defaultModelKey, '无频道声明时回落全局默认')
})

test('带图请求绝不落到频道的文本档', () => {
    const channelConfig = {model: 'relay_common_pro'}
    assert.equal(
        pickModelKey({channelConfig, hasInputs: true}),
        defaultVisionModelKey,
        '频道没声明 visionModel 时走全局视觉默认',
    )
    assert.equal(
        pickModelKey({channelConfig: {model: 'relay_common_pro', visionModel: 'relay_qwen_vl_low'}, hasInputs: true}),
        'relay_qwen_vl_low',
        '频道声明了 visionModel 则用之',
    )
})

test('历史供应商名归一到档位，非法值回落默认', () => {
    assert.equal(resolveModelKey('qwenVLPlus'), 'relay_qwen_vl_pro')
    assert.equal(resolveModelKey('deepseek31'), 'relay_deepseek_pro')
    assert.equal(resolveModelKey('不存在的模型'), defaultModelKey)
    assert.equal(
        pickModelKey({llmModel: 'qwen3xin', channelConfig: {model: 'relay_common_pro'}}),
        'relay_qwen_flash',
        '历史名走别名，不受频道档影响',
    )
})
