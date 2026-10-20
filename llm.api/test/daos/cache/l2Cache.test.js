import { test } from 'node:test'
import * as assert from 'node:assert'
import {cacheGet, cacheSet, cacheDel, remember, acquireOnce, getLRU} from '../../../daos/cache/l2Cache.js'

/**
 * 测试环境没有 llm 全局，redisClient 在模块加载期就要读 llm.config，
 * 动态 import 必然失败 —— 正好用来验证"缓存层不可用时一律 fail-open"这条硬约束。
 */
const space = () => 'unit-' + Math.random().toString(36).slice(2)

test('redis 不可用时 cacheGet 报未命中而不是抛错', async () => {
  const ret = await cacheGet('any:key', space())
  assert.equal(ret.hit, false)
  assert.equal(ret.value, undefined)
})

test('cacheSet 仍然写进进程内 LRU，后续读取命中 lru', async () => {
  const s = space()
  const key = `t:${s}`
  const wroteRedis = await cacheSet(key, {n: 1}, {ttlSeconds: 30, space: s})
  assert.equal(wroteRedis, false, 'redis 不可用应报告未写入')
  const found = await cacheGet(key, s)
  assert.equal(found.hit, true)
  assert.equal(found.source, 'lru')
  assert.deepEqual(found.value, {n: 1})
})

test('remember 未命中回源一次，第二次直接命中缓存', async () => {
  const s = space()
  let calls = 0
  const loader = async () => { calls++; return ['x'] }
  const first = await remember({key: 'r:1', loader, options: {space: s, ttlSeconds: 60}})
  assert.equal(first.source, 'origin')
  assert.deepEqual(first.value, ['x'])
  const second = await remember({key: 'r:1', loader, options: {space: s}})
  assert.equal(second.source, 'lru')
  assert.equal(calls, 1, '回源只应发生一次')
})

test('remember 的 loader 抛错时向上传递，不写脏缓存', async () => {
  const s = space()
  await assert.rejects(
    remember({key: 'r:bad', loader: async () => { throw new Error('回源失败') }, options: {space: s}}),
    /回源失败/)
  assert.equal((await cacheGet('r:bad', s)).hit, false)
})

test('remember 无键或无 loader 时直接透传，不假装命中', async () => {
  assert.equal((await remember({key: '', loader: async () => 1})).source, 'uncached')
  const noLoader = await remember({key: 'k', loader: null})
  assert.equal(noLoader.value, null)
  assert.equal(noLoader.source, 'uncached')
})

test('acquireOnce 在 redis 不可用时放行，去重不能变成丢任务', async () => {
  assert.equal(await acquireOnce('lock:any', 60), true)
  assert.equal(await acquireOnce('', 60), true)
})

test('cacheDel 清掉指定命名空间的进程内缓存', async () => {
  const s = space()
  await cacheSet('d:1', {v: 1}, {space: s})
  assert.equal((await cacheGet('d:1', s)).hit, true)
  await cacheDel('d:*', s)
  assert.equal((await cacheGet('d:1', s)).hit, false)
})

test('getLRU 同命名空间复用同一实例', () => {
  const s = space()
  const a = getLRU(s, {max: 2, ttlMs: 1000})
  a.set('k', 1)
  const b = getLRU(s, {max: 99, ttlMs: 5})
  assert.equal(b.get('k'), 1, '同一命名空间必须是同一份缓存，否则选项会被后写覆盖')
  assert.equal(b.stats().max, 2, '首次创建的参数生效')
})
