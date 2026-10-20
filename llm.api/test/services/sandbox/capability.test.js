import { test } from 'node:test'
import * as assert from 'node:assert'
import {
  issueCapabilityToken,
  verifyCapabilityToken,
  CAPABILITIES,
} from '../../../services/sandbox/capability.js'

const SEC = 'test-secret'
const NOW = 1700000000000

const issue = (over = {}) => issueCapabilityToken({
  secret: SEC, sandboxId: 'sb-1', conversationCode: 'c-1', userCode: 'u-1',
  caps: ['extract'], now: NOW, ...over,
})

test('签发的 token 能被校验，并带回载荷', () => {
  const {token} = issue()
  const ret = verifyCapabilityToken({secret: SEC, token, cap: 'extract', sandboxId: 'sb-1', now: NOW})
  assert.equal(ret.ok, true, ret.reason)
  assert.equal(ret.payload.sid, 'sb-1')
  assert.deepEqual(ret.payload.caps, ['extract'])
})

test('支持 Bearer 前缀与尾随空白', () => {
  const {token} = issue()
  assert.equal(verifyCapabilityToken({secret: SEC, token: `Bearer ${token} `, cap: 'extract', now: NOW}).ok, true)
})

test('篡改载荷、换密钥、格式错误都拒绝', () => {
  const {token} = issue()
  const [body, sig] = token.split('.')
  const evil = Buffer.from(JSON.stringify({sid: 'sb-1', conv: '', usr: '', caps: ['extract', 'anything'], exp: NOW + 10 ** 12}))
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  assert.equal(verifyCapabilityToken({secret: SEC, token: `${evil}.${sig}`, cap: 'extract'}).ok, false)
  assert.equal(verifyCapabilityToken({secret: 'other-secret', token, cap: 'extract'}).ok, false)
  assert.match(verifyCapabilityToken({secret: SEC, token: 'no-dot-here'}).reason, /格式/)
  assert.equal(verifyCapabilityToken({secret: '', token, cap: 'extract'}).ok, false, '没配密钥时必须拒')
})

test('过期即失效，未过期才通过', () => {
  const {token, expiresAt} = issue({ttlMs: 60_000})
  assert.equal(expiresAt, NOW + 60_000)
  assert.equal(verifyCapabilityToken({secret: SEC, token, cap: 'extract', now: expiresAt + 1}).ok, false)
  assert.equal(verifyCapabilityToken({secret: SEC, token, cap: 'extract', now: expiresAt}).ok, true)
})

test('能力不能越界：未带该能力或沙箱不符都拒绝', () => {
  const {token} = issue()
  const noCap = verifyCapabilityToken({secret: SEC, token, cap: 'delete', now: NOW})
  assert.equal(noCap.ok, false)
  assert.match(noCap.reason, /未包含/)
  assert.equal(verifyCapabilityToken({secret: SEC, token, cap: 'extract', sandboxId: 'other-sb', now: NOW}).ok, false,
    'token 必须绑沙箱，不能被别的沙箱复用')
})

test('签发时校验能力白名单与必要字段', () => {
  assert.throws(() => issueCapabilityToken({secret: SEC, sandboxId: 's', caps: ['shell']}), /未登记的能力/)
  assert.throws(() => issueCapabilityToken({secret: SEC, sandboxId: 's', caps: []}), /至少要带一个能力/)
  assert.throws(() => issueCapabilityToken({secret: '', sandboxId: 's', caps: ['extract']}), /签名密钥/)
  assert.throws(() => issueCapabilityToken({secret: SEC, caps: ['extract']}), /需要 sandboxId/)
})

test('重复能力去重，且白名单外延不开新口子', () => {
  const r = issue({caps: ['extract', 'extract']})
  assert.deepEqual(r.caps, ['extract'])
  assert.equal(CAPABILITIES.includes('extract'), true)
})
