import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import {
    pickIdempotentHit, isDuplicateKeyError, buildIdemFilter,
} from '../../../../services/core/session/taskIdempotency.js'

/**
 * 幂等判据件（§4-1 进行中）穷举。钉三条：
 * ① 命中要**二次核对键**——filter 拼错把别人的任务当幂等命中，比没幂等更糟；
 * ② 幂等响应必须回**同一 rootCode** ⇒ 命中取最旧行，不依赖调用方排序；
 * ③ E11000 有三种错误形状（顶层 code / writeErrors[] / 消息文本），漏一处并发分支就当普通失败吞。
 */
describe('pickIdempotentHit', () => {
    const row = (agentCode, key, at) => ({agentCode, params: {idemKey: key}, insertTime: new Date(at)});

    test('无 key/无 rows ⇒ null（不许"没查到"混成"命中第一行"）', () => {
        assert.equal(pickIdempotentHit({rows: [row('a', 'k1', 1)], keyField: 'idemKey', keyValue: ''}), null);
        assert.equal(pickIdempotentHit({rows: [], keyField: 'idemKey', keyValue: 'k1'}), null);
        assert.equal(pickIdempotentHit({rows: [row('a', 'k1', 1)], keyField: '', keyValue: 'k1'}), null);
    });

    test('只认键精确相等的行（查询错位防御）', () => {
        const hit = pickIdempotentHit({rows: [row('a', 'other', 1), row('b', 'k1', 2)], keyField: 'idemKey', keyValue: 'k1'});
        assert.equal(hit?.agentCode, 'b');
    });

    test('多命中取最旧（同一幂等键的响应必须永远指向同一个 rootCode）', () => {
        const rows = [row('new', 'k1', 2000), row('old', 'k1', 1000)];
        assert.equal(pickIdempotentHit({rows, keyField: 'idemKey', keyValue: 'k1'}).agentCode, 'old');
    });

    test('行缺 insertTime 不炸（Date(NaN) 排序兜底仍返回行而非抛）', () => {
        const hit = pickIdempotentHit({rows: [{agentCode: 'x', params: {idemKey: 'k'}}], keyField: 'idemKey', keyValue: 'k'});
        assert.equal(hit?.agentCode, 'x');
    });

    test('serialized-turn 场景用 messageCode 子字段（键字段是参数不是硬编）', () => {
        const rows = [{agentCode: 'a', params: {messageCode: 'm1'}, insertTime: new Date(1)}];
        assert.equal(pickIdempotentHit({rows, keyField: 'messageCode', keyValue: 'm1'}).agentCode, 'a');
    });
});

describe('isDuplicateKeyError', () => {
    test('顶层 code=11000 ⇒ true', () => assert.equal(isDuplicateKeyError({code: 11000}), true));
    test('bulkWrite 形状：writeErrors[].code=11000 ⇒ true', () => {
        assert.equal(isDuplicateKeyError({writeErrors: [{code: 5}, {code: 11000}]}), true);
    });
    test('只有消息文本 E11000/duplicate key ⇒ true', () => {
        assert.equal(isDuplicateKeyError({message: 'E11000 duplicate key error collection: agentTask index'}), true);
        assert.equal(isDuplicateKeyError({message: 'DuplicateKey error'}), true);
    });
    test('普通错误/null ⇒ false（不许把什么都当重复）', () => {
        assert.equal(isDuplicateKeyError({message: 'mongo down', code: 'INTERNAL'}), false);
        assert.equal(isDuplicateKeyError(null), false);
        assert.equal(isDuplicateKeyError(new Error('timeout')), false);
    });
});

describe('buildIdemFilter', () => {
    test('形状：conversationCode+agentRole+params 点键；waitingOnly 默认带上 handleStatus:0', () => {
        const f = buildIdemFilter({conversationCode: 'c', agentRole: 'serialized-turn', keyField: 'messageCode', keyValue: 'm1'});
        assert.deepEqual(f.complexFilter, {
            conversationCode: 'c', agentRole: 'serialized-turn', 'params.messageCode': 'm1', handleStatus: 0,
        });
    });
    test('orchestrated root 用 waitingOnly:false（跑完的行也占键，幂等键一次性）', () => {
        const f = buildIdemFilter({conversationCode: 'c', agentRole: 'root', keyField: 'idemKey', keyValue: 't1', waitingOnly: false});
        assert.equal(f.complexFilter.handleStatus, undefined);
        assert.equal(f.complexFilter['params.idemKey'], 't1');
    });
});
