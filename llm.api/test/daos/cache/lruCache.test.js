import { test } from 'node:test'
import * as assert from 'node:assert'
import {createLRU} from '../../../daos/cache/lruCache.js'

const tick = (ms = 5) => new Promise(r => setTimeout(r, ms))

test('LRU 基本读写与缺失键返回 undefined', () => {
  const lru = createLRU({max: 3, ttlMs: 0})
  assert.equal(lru.get('a'), undefined)
  lru.set('a', 1)
  assert.equal(lru.get('a'), 1)
  assert.equal(lru.has('a'), true)
  assert.equal(lru.size(), 1)
  assert.equal(lru.get('falsy'), undefined)
  lru.set('zero', 0)
  assert.equal(lru.get('zero'), 0, '0 是有效缓存值，不能被当成未命中')
  lru.set('empty', '')
  assert.equal(lru.get('empty'), '')
})

test('LRU 超出 max 按最近使用淘汰', () => {
  const lru = createLRU({max: 2, ttlMs: 0})
  lru.set('a', 1)
  lru.set('b', 2)
  assert.equal(lru.get('a'), 1, '命中即刷新使用顺序')
  lru.set('c', 3)
  assert.equal(lru.size(), 2)
  assert.equal(lru.peek('b'), undefined, 'b 是最久未用的，应被淘汰')
  assert.equal(lru.peek('a'), 1)
  assert.equal(lru.peek('c'), 3)
  assert.equal(lru.stats().evictions, 1)
})

test('LRU 的 peek 不改变淘汰顺序', () => {
  const lru = createLRU({max: 2, ttlMs: 0})
  lru.set('a', 1)
  lru.set('b', 2)
  assert.equal(lru.peek('a'), 1)
  lru.set('c', 3)
  assert.equal(lru.peek('a'), undefined, 'peek 不算使用，最久未用的 a 仍应被淘汰')
  assert.equal(lru.peek('b'), 2)
  assert.equal(lru.peek('c'), 3)
})

test('LRU 到期即失效并计入统计', async () => {
  const lru = createLRU({max: 4, ttlMs: 10})
  lru.set('a', 1)
  assert.equal(lru.get('a'), 1)
  await tick(20)
  assert.equal(lru.get('a'), undefined)
  assert.equal(lru.size(), 0)
  const s = lru.stats()
  assert.equal(s.expirations, 1)
  assert.equal(s.hits, 1)
  assert.equal(s.misses, 1)
})

test('LRU 覆盖同键不增长且刷新时间', async () => {
  /** 留足时间余量：setTimeout 可能提前几毫秒触发，压线断言会变成随机失败 */
  const lru = createLRU({max: 2, ttlMs: 50})
  lru.set('a', 1)
  await tick(30)
  lru.set('a', 2)
  assert.equal(lru.size(), 1)
  await tick(30)
  /** 距首次写入已 60ms（>50），距最近写入 30ms：仍读到 2 说明重写重置了存活期 */
  assert.equal(lru.get('a'), 2, '重新写入应重置存活期')
})

test('LRU 对非法参数回落到默认值而不崩', () => {
  const lru = createLRU({max: 0, ttlMs: -1})
  assert.equal(lru.stats().max, 128)
  assert.equal(lru.stats().ttlMs, 0)
  const plain = createLRU()
  plain.set('k', 'v')
  assert.equal(plain.get('k'), 'v')
  assert.equal(plain.delete('k'), true)
  assert.equal(plain.get('k'), undefined)
  plain.set('x', 1)
  plain.clear()
  assert.equal(plain.size(), 0)
})
