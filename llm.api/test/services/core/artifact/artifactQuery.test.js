import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
// 投影纯件零依赖，直接静态 import；artifactQuery 的 IO 链不进单测进程（守卫只读源码文本）
import {projectArtifactRow} from '../../../../services/core/artifact/artifactRow.js'

/**
 * 产物查询面（刀 B 服务端前置）。权限判定不在这里重测（resolveMessageScope 自有穷举先例），
 * 这里钉两件事：投影的"缺席如实 null"，以及**接线不许另造真相**的源码位守卫。
 */
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../')
const readSrc = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r/g, '')

describe('projectArtifactRow', () => {
    test('全字段行照抄；缺键 ⇒ null（不补 0/空串——"没记录"与"记录为 0"是两回事）', () => {
        const full = {
            artifactCode: 'a1', name: 'report.md', kind: 'file', state: 'ready', integrity: 'ok',
            version: 3, parentArtifactCode: 'a0', lineageRootArtifactCode: 'r0',
            sizeBytes: 4096, fileUrl: 'https://x/y', insertTime: 't1', readyAt: 't2',
        }
        assert.deepEqual(projectArtifactRow(full), full)
        const bare = projectArtifactRow({artifactCode: 'a2'})
        assert.equal(bare.name, null)
        assert.equal(bare.sizeBytes, null)
        assert.equal(bare.state, null, 'state 缺席不许渲染成 0（?? 而非 || 的用例锚）')
    })
    test('脏 version/sizeBytes ⇒ null；artifactCode 空 ⇒ 空串（键必须在）', () => {
        assert.equal(projectArtifactRow({artifactCode: 'x', version: 'abc'}).version, null)
        assert.equal(projectArtifactRow({artifactCode: 'x', sizeBytes: 'n'}).sizeBytes, null, '非数字脏值 ⇒ null')
        assert.equal(projectArtifactRow({}).artifactCode, '')
    })
})

describe('接线守卫：权限与读回必须复用单源，不许另造第二套真相', () => {
    test('artifactQuery 用 resolveMessageScope（成员制）与 executeReadArtifactTool（状态闸）', () => {
        const q = readSrc('services/core/artifact/artifactQuery.js')
        assert.ok(/import \{resolveMessageScope\} from '..\/messageScope\.js'/.test(q), '可见性没复用 resolveMessageScope')
        assert.ok(/import \{executeReadArtifactTool\} from '.\/readArtifactTool\.js'/.test(q), '读回没复用执行体')
        assert.ok(/import \{makeArtifactReader\} from '.\/intakeWiring\.js'/.test(q), 'deps 没复用 makeArtifactReader')
        assert.ok(!/row\.state ===|state !== 'ready'/.test(q.split('checkMember')[1] || ''), 'artifactQuery 里不许自写状态闸（执行体已有）')
    })
    test('路由存在且 body 有必填约束（autoload 目录扫描=drop-in，注册无需改 app.js）', () => {
        const r = readSrc('routes/core/artifact/root.js')
        assert.ok(/required: \['conversationCode'\]/.test(r), '/list 缺必填')
        assert.ok(/required: \['artifactCode'\]/.test(r), '/read 缺必填')
        assert.ok(/err\.statusCode = 403/.test(r), '非成员没映射 403')
        assert.ok(/userInfo\?\.userCode/.test(r), '身份校验缺失（内部路径不能当已鉴权，D57 同规）')
    })
})
