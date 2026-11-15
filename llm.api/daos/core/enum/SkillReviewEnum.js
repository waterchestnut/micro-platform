/**
 * @fileOverview 远程技能的审核生命周期
 * @module daos/core/enum/SkillReviewEnum
 * @description
 * 与 `StatusEnum` 分工不同：`StatusEnum` 表达软删除（`BaseDac` 会隐式过滤 `status: -1`），
 * 本枚举表达**内容是否被批准进入用户上下文**。刻意用独立字段 `reviewStatus` 承载，
 * 理由与 `MemoryStatusEnum` 文件头同一条：把"待审"塞进软删语义，会让待审记录被默认过滤掉、断掉证据链，
 * 还会让管理端列表看不见"有一条正等着我批"。
 *
 * 第三个值 `revoked` 是这次加的：批准过、后来发现内容不对，需要"以前批过、现在作废"这一态。
 * 没有它的话只能回退到 `pending`，而 `pending` 会让审计看起来像"从没审过"——
 * 那是把一次撤销伪装成一次遗漏（同 H1 的"缺键与 0 不能混读"）。
 */
import Enumify from '../../../extends/Enumify.js'

export default class SkillReviewEnum extends Enumify {
    static pending = new SkillReviewEnum('pending', '待审核')
    static approved = new SkillReviewEnum('approved', '已批准')
    static rejected = new SkillReviewEnum('rejected', '已驳回')
    static revoked = new SkillReviewEnum('revoked', '批准后作废')
    static _ = this.closeEnum()
}
