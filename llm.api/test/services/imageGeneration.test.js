/**
 * 文生图服务单测：入参闸（不打下游）+ image 族配置存在性 + 路由注册形状
 */
import assert from 'node:assert/strict'
import {test} from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {relayModels} from '../../conf/llmModel.js'
import {generateImage} from '../../services/core/imageGeneration.js'

const here = path.dirname(fileURLToPath(import.meta.url))

test('入参闸：空/超长/非法尺寸都被拒且不下游', async () => {
    const r1 = await generateImage({prompt: '   '}, {})
    assert.equal(r1.code, 4001)
    const r2 = await generateImage({prompt: 'x'.repeat(4001)}, {})
    assert.equal(r2.code, 4001)
    assert.match(r2.msg, /过长/)
    const r3 = await generateImage({prompt: 'ok', size: '31x7'}, {})
    assert.equal(r3.code, 4001)
    assert.match(r3.msg, /尺寸不在支持列表/)
})

test('image 族三档配置齐（relay 出口同址、真实模型名对）', () => {
    for (const k of ['relay_image_pro', 'relay_image_flash', 'relay_image_low']) {
        const m = relayModels[k]
        assert.ok(m, `缺档位 ${k}`)
        assert.equal(m.family, 'image')
        assert.ok(m.baseURL && m.apiKey, `${k} baseURL/apiKey 未配`)
        assert.match(m.model, /^image-(pro|flash|low)$/, `${k} 模型名错 ${m.model}`)
    }
})

test('路由文件注册形状（autoPrefix 与既有 *-my 面同构，鉴权由全局钩子负责）', () => {
    const src = fs.readFileSync(path.join(here, '../../routes/core/image/root.js'), 'utf8')
    assert.match(src, /autoPrefix = '\/core\/image'/)
    assert.match(src, /post\('\/generation'/)
    assert.match(src, /required: \['prompt'\]/)
})
