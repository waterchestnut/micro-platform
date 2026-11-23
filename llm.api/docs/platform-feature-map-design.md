# 平台功能全貌 · 会话内推荐与调用方案（Feature Map for Chat）

| | |
|---|---|
| 文档版本 | v0.3（2026-11-23 属主裁定落定 + 核查轮 V1~V10 修订入正文，§11 留核查记录） |
| 编制日期 | 2026-11-23 |
| 适用 | `xxzx.*` 及所有 micro-platform 底座搭建的平台（方案平台无关：目录是数据不是代码） |
| 主落点仓库 | `xxzx.llm.api`（装配与执行面）、`micro-platform`（底座镜像）、各子系统（注册源） |
| 现状取材 | 全部为活码定位（2026-11 本会话实测），非记忆 |

## 0. 问题陈述

平台由多子系统构成（callin 调研、learoad、raisef、mopit、portal/菜单、resource、ucenter 权限…），功能按角色划分。通用聊天频道的 AI 现状：对平台功能**没有全貌认知**——用户问"我想批量导出周报"只能靠模型幻觉或答非所问。目标两种消费：

- **A 推荐引导**：基于用户角色，告诉 TA"平台有什么功能能解决你的需求 + 入口在哪"；
- **B 直接调用**：AI 代替用户执行平台功能（查询直接给答案；操作类先确认再执行），把结果带回会话。

## 1. 既有积木盘点（方案建立在它们之上，不另起炉灶）

| 积木 | 位置（活码） | 在本方案中的角色 |
|---|---|---|
| **grpcSkill 技能注册面** | mongo `grpcSkill`：`skillName/skillMD(SKILL.md)/channels/status` + **审核生命周期**（PR-E0.1 已在架：`reviewStatus` 默认 **pending=新注册默认不进任何用户上下文**、`skillMDHash` 批准哈希比对不一致即剔除+回 pending 防 rug-pull、`contentVersion` 让审计说出"批的是第 3 版在跑第 5 版"） | **功能目录的载体**——扩展字段而非新建集合（§2）；SKILL.md"人类+模型双可读"的正文形状就是目录条目的描述面 |
| **ucenter 权限 RPC** | `grpc/clients/userInfo.js` `hasPriv(userCode, needPrivs)`（deadline/超时纪律已在） | 目录的**角色过滤与调用复验**单源判据（§4/§5） |
| **技能装配链** | `skillChat`/`skillManager`（频道→技能清单→工具注入，lru 缓存实测命中） | 推荐/调用两面的运行时通路 |
| **skillScan** | 注册内容安全扫描（exfiltration-instruction 等规则） | 目录正文的防注入面（条目=人写文案，进 prompt 即 untrusted content） |
| **skillWriteIdempotency** | B-4 二期写面幂等闸（`${runCode}:${toolCallId}` claim 账本；**机制已上线 dev，名单如实空**=P5 批待写面工具） | 写面调用的执行闸（§4-B2），与 P5 开闸同批 |
| **ask_user / await_input（MRTR）+ 澄清冒泡** | §7-1 三仓闭环（console/callin/底座 UI 就绪） | 写面"提案→确认"交互的现成通道（approval 语义 callin 线已有先例） |
| **constraints.js（permission 类）** | 记忆线 PR-I/M：`kind: permission|commitment|rule` + 整条进出 + 出槽 violations | 授权约束进 prompt 的渲染纪律先例（目录权限面复用同一性格） |
| **fan-out 编排/taskMode** | M1~M5 全链 dev 已开闸（批②~⑧） | 多步组合的**候选**载体——仅在实测有组合需求时启用（§8 红线：不过度承诺） |
| **审计家族** | skillWriteJournal、cronRunLog、taskEvent 镜像 | 功能调用账（§6）同法新建 |

**结论：本方案的增量不是"新建机制"，是把八块已有积木接成一条"目录→过滤→推荐/调用→审计"的链。**

## 2. 核心对象：功能目录条目（Feature Catalog Entry）

载体 = `grpcSkill` 集合扩展字段（新增字段必须声明 schema——本仓教训三连，未声明=静默丢）：

```
{
  // —— 既有面：skillName / skillMD / channels / status / approveStatus / skillMDHash / contentVersion
  // —— 扩展面（NEW 字段）：
  effectClass:    'guide' | 'read' | 'write',     // 三级：仅引导 / 只读调用 / 有副作用操作
   featurePrivs:   [String],                        // 功能级权限点（子系统内细粒度；空=入口内公共）；browse 入口门不在此列（§9 两层模型，11-23 属主修正）
   browseGate:     Boolean,                         // 入口门控事实（=client 注册表 needAuth2Show 同步）⇒ 需 hasPriv({clientCode}-browse)
  entry:          { subsystem, menuPath?, url? },  // 引导面：url=主应用路由（/sub/{clientCode} 或主应用自身路由，D4 裁定；禁子应用直链）
  invokeSpec:     { handler|api, paramsSchema, timeoutMs },  // read/write 的调用形状（复用现 grpcSkill 方法面）
  idemKeyPolicy:  'per-run' | 'explicit',          // write 必填（接 skillWrite 闸的键策略）
  sourceManifest: { subsystemCode, version, repo?, stamp },  // 注册源溯源（§3 防漂移）
}
```

**目录条目的描述纪律**（写进审核 checklist）：
- `description` 面向"用户意图"不是"系统模块"：写"当用户想批量导出…时"，不写"XX子系统YY模块"；
- `entry.url` 必须是**已核活的入口**（§3 探针）；无入口=guide 级不合格；
- write 条目必须写"副作用一句话"（会改什么、能否撤销）——这是给用户确认文案的原料，也是 approval 气泡的内容源。

## 3. 目录的生成与维护（对抗漂移——本方案的慢性病）

- **注册源=子系统侧受控 manifest**：每个子系统在自己的 git 里维护 `feature-manifest`（条目+版本），发布时调注册接口（带管理员鉴权）推 llm.api。**禁止运行时爬菜单/扫路由自动生成**——扫描产物可作**初稿工具**（离线、人审后入），但运行时装配只认已审核入库的条目（菜单是给人点的，语义给 AI 的描述必须人写）。
- **防漂移三件**（已有机制复用为主）：
  1. `skillMDHash` 变更检测（PR-E0.1 在架）：子系统升级改了 manifest → 哈希比对 → 回 pending + 告警；
  2. **入口活性探针**：定时任务对 guide/read/write 条目的 `entry.url` / `invokeSpec.api` 做轻量可达探测（不执行副作用）。**判死标准（V6，防 D6 自动下线误杀）**：401/403=**活着**（恰恰证明入口存在且受保护），只有超时/DNS 失败/持续 5xx 且**连续两轮**确认才标 stale；首轮可疑只记 runStats 计数；
  3. manifest `version/stamp` 入条目（平台版本闸同族思路），对账可溯源。
- **生命周期**：pending（新/变更）→ approved（管理员审核，**skillScan 必须先过**——目录正文进 prompt 即注入面）→ active → stale/offline。
- **治理前置（2026-11-23 开工前实查更正）**：设计初稿引的"零权限判断"是 `skillGovernance.js` 头注里 **2026-11-13 的历史快照**——**PR-E0.1 早已把这条修完**：`authorizeSkillWrite` 挂全部六个写入口（add/update/delete/enable/disable/review，判据先于内容校验、先于落库）、ucenter `hasPriv(userCode, privCodes)` fail-closed（ucenter 挂了=无权限，不留自动放行后门）、`reviewStatus` 默认 pending 不进装配、`skillMDHash` 防 rug-pull、拒绝回 4xx 且集成测试在架（`test/routes/grpcSkillAuth.test.js`）。**Phase 0 的真实剩余=运维数据**：①ucenter 建档独立 priv 点（D1 裁定 `platform-catalog:manage`）②env `grpcSkill_privCodes='["platform-catalog:manage"]'`（过渡兜底 `grpcSkill_adminUserCodes` 清单）③dev/生产各自配置。**代码零新增即达标**，本方案开工不被治理卡。

## 4. 会话内消费链

### A 推荐与引导（guide 级 + 全目录检索面）
- **两段注入，全目录永不进 prompt**：
  1. **域简介常驻**（sysPrompt 级，频道配置）：每子系统一行"能解决什么"，**不含权限敏感细节**——让模型知道"平台有哪些方向"从而发起检索，而不是直接背目录；
  2. **按需检索工具 `platform_features`**（NEW，判据件+装配进技能链）：入参=意图关键词/子系统名；执行=拉当前会话 `userCode` 的可见目录（§5 过滤）→ 返回 top-k 条目（title/description/entry/引导话术原料）。**模型只能引用检索结果，不许自由生成入口**——目录里没有的功能，如实说"平台目前没有现成功能，建议…"（缺席不编造，本仓一贯纪律的 UI 化）。
- 消费面：模型拿到条目后**说人话引导**（"你可以在 XX → YY 做这件事"），需要时附入口链接。

### B 直接调用
- **B1 read（查询/统计/检索）**：沿用现 grpcSkill 方法面（在册 8 技能即此形状：res-discovery/learoad-stat/raisef-stat/user-score…）。执行前**服务端 hasPriv 复验**（§5），执行=现有工具调用通路，结果回会话。**Phase 1 全部开在这一级**——无副作用、账面无新增风险。
- **B2 write（有副作用操作）**：三段式，全部用现成机制串：
  1. **提案**：模型选 write 条目 → 装配层生成"我要替你做什么"确认题（含条目的副作用一句话 + 关键参数回显），经 **ask_user/await_input**（§7-1 在架）发回 UI；
  2. **确认**：用户答复（MRTR `/answer`；approval 语义按 callin 线先例只认发起人）——未确认/超时 = 不执行（**永不静默执行副作用**）；
  3. **执行**：走 **skillWriteIdempotency 闸**（键= `${runCode}:${toolCallId}`，claim/done/refuse 账在架，P5 批名单登记本条目）——崩溃重放从"必然双跑"变"最多拒跑"；执行结果回会话。
  - 与 P5 的关系：本方案就是"写面技能上架"的具象——**P5 的开闸名单第一批 = 本目录的 write 条目**，两件事同批执行，互为前提。
- **B3 多步组合**（跨功能的"帮我完成 X"）：**Phase 4 之前不做**。判定推迟的理由：单工具调用+引导尚未有真实使用读数，组合拆解=在没有分母的面上开编排复杂度。真需求出现时载体现成（taskMode fan-out）。

## 5. 权限模型（方案的生命线——三段防线）

```
用户 → [防线1 装配过滤] → 模型视野 → [防线2 执行复验] → 子系统 API → [防线3 审计]
```
1. **防线 1 · 装配过滤**：`platform_features` 与技能清单装配时，按两层合取过滤（`browseGate ⇒ hasPriv({clientCode}-browse)` ∧ `hasPriv(featurePrivs)`，§9 权限两层模型）——**用户无权限的功能对模型不存在**（不推荐、不提及：目录名本身可能是敏感信息，如未上线/内部子系统）。推荐即披露，披露即权限面。**检索 miss 统一措辞（V4）**：命中 0 条与"关键词不存在/无权限"返回同一形状（空集+同一提示语），不给"探测 A 空、B 有"的存在性 oracle；高频 miss 探测进审计告警。
2. **防线 2 · 执行复验**：工具被调用时，**服务端以会话 userCode 重跑 hasPriv**——不信任模型转述（模型可能幻觉出不存在的 privs 组合、被注入文案诱导、或拿错参数）。执行身份=该用户本人凭证（`user-info` 透传现形），调的 API 走子系统对 humans 的**同一条鉴权中间件**——AI 权限恒等于用户权限，不更高。**参数面同受本防线（B0-1/B0-2）**：privs 对了不代表参数对了，身份覆写与参数冻结在执行壳强制。
3. **防线 3 · 审计**：每次目录检索/功能调用落账（§6），越权请求（防线 2 拒）单独标记上报——"模型被诱导尝试越权"是攻击面探测器。

性能纪律（V8）：每轮装配对条目逐条 RPC hasPriv 不可接受——**priv 判定按 run 首查批量**（needPrivs 全集去重一次 hasPriv），run 内复用快照；撤销生效窗=run 粒度（下一个 run 生效，与"角色变化处理"同条纪律，不额外承诺实时性）。

角色变化处理：目录过滤发生在**每轮装配**（不缓存跨用户结果——lru 键必须含权限签名维度，现有 skill lru 键"频道"级，扩为"频道×privs 摘要"，否则 A 用户的缓存喂给 B 用户=权限泄漏的第三条路）。

## 6. 审计与观测

- **功能调用账集合**（`featureCallLog`，NEW，同 skillWriteJournal 家规：声明 schema、TTL/retention 进既有治理）：`{userCode, conversationCode, runCode, featureCode, effectClass, decision: recommended|invoked|confirmed|refused|failed, privilegeCheck, latencyMs}`。
- **runStats 观测面**（"看不见=没有"家族，同 orchestration/taskEvents/creditsWeights 三面先例）：目录规模（active/pending/stale 计数）、探针剔除数、本日推荐/调用/越权拒绝计数。
- 值班口径：推荐不响、调用失败、条目消失——各有直接读数面，不烧会话反推。

**降级面如实（V7）**：fail-closed 的另一面是"ucenter 挂了 ⇒ 检索全空 ⇒ AI 说'平台没有功能'"——这是**错话不是保守**。检索工具执行壳区分两态：权限判定成功且过滤后为空 ⇒ "没有匹配功能"；hasPriv RPC 失败 ⇒ 工具返回 `permission-service-unavailable`，模型如实表达"暂时无法确认功能权限，稍后再试"（缺省不装"没有"，缺席≠零 家族）。runStats 目录面加 `ucenterUnavailable` 计数。

**审计双标（V9）**：featureCallLog 必带 `actorKind: human|ai`（人点菜单与 AI 代理执行在审计上必须分得开——"谁干的"是所有事后归因的第一问）与 `identityOverridden: Boolean`（B0-1 触发痕迹=参数冒充尝试的探测器，越权标记之外的第二种攻击信号）。

## 7. 分期路线（每刀默认关、判据先行、有验收——本仓家规）

| Phase | 内容 | 验收 | 依赖 |
|---|---|---|---|
| **0 治理与容器**（**代码部分已备**——PR-E0.1 实查更正：六写入口授权+fail-closed+pending 默认+哈希全在架，含拒绝路径集成测试） | 剩余=①运维：ucenter 建 `platform-catalog:manage` 权限点 + env `grpcSkill_privCodes`；②本刀：目录扩展字段（schema 声明，默认值零行为） | 非管理员注册被拒（测试已在架）；扩展字段落库不静默丢（cast 用例） | 无 |
| **1 推荐引导** | `platform_features` 检索工具（纯判据件+装配）；sysPrompt 域简介（频道级，默认关）；权限过滤+lru 键扩签名；审计账开写 | 越权条目对模型不可见（双用户对照 e2e）；引导引用只出自目录；runStats 面在账 | Phase 0 |
| **2 只读调用扩容** | read 条目按首批子系统铺开（候选：learoad/raisef/callin 统计面已存在→补"意图描述"即可用）；执行复验全量生效 | 真链 e2e：提问→工具→答案；复验拒越权 | Phase 1 |
| **3 写面调用** | B2 三段式接通（ask_user 提案 + P5 skillWrite 名单同批）；确认文案模板（副作用一句话）；崩溃重放探针（journal 形状实测） | 未确认=零副作用；确认后执行成功；重放不双跑 | Phase 2 + UI 三仓点验（澄清面在架） |
| **4 组合与自适应**（**预留不开工**） | fan-out taskMode 承载多步功能编排；跨会话的功能使用画像（记忆线接口） | 实测需求账出现才立项 | 真实使用量 |

## 8. 红线（别做清单）

- **不把全目录塞 sysPrompt**：长度/越权披露/漂移缓存三重坏。常驻只放域简介。
- **不让模型自由生成入口 URL/功能名**：引用只出自检索结果；目录没有=如实说没有（幻觉功能=对用户最坏的一次回答）。
- **不信任模型转述的权限**：执行复验以会话 userCode 单源；`user-info` 是事实源不是建议。
- **写面不静默执行**：确认缺失即中止；开闸顺序=幂等闸+审核名单先于任何 write 条目 active。
- **运维数据未就位时 write/review 面不开工**：治理代码已备（PR-E0.1 实查更正），但 `privCodes` 未配 + ucenter 权限点未建档 ⇒ hasPriv 全员 false ⇒ 没人能注册/审核——write 条目上架前这两件必须先落（reject 面反向验证可用，allow 面依赖权限数据）。
- **不做运行时爬菜单自动生成**：扫描只作离线初稿工具；入目录必须过人审+skillScan。
- **不提前建 B3 组合编排**：没账不造刀（编排线 M4 当年"不做依赖调度不承诺"的同款自律）。
- **lru 键不带权限维度 = 事故**：装配缓存必须按"频道×权限签名"分片（防线 1 的实现陷阱，单独立用例）。
- **模型参数里没有"可信的 userCode"**（B0-1）：身份类参数一律服务端覆写；子系统侧"信任上游传的工号"的接口在挂入 read/write 名单前必须先收口参数面鉴权（AI 代理调用的子系统侧改造义务，随注册评审）。
- **确认了什么就执行什么**（B0-2）：执行参数=提案存档参数，重算即拒；不存在"模型记得用户批准过"。
- **per-run 幂等键的条目不进写面名单**（B0-3）：跨 run 稳定性是 Phase 3 名单准入门槛。

## 9. 裁定记录（2026-11-23 属主拍板，本表为准，§正文已按此对齐）

| # | 裁定 | 落地含义 |
|---|---|---|
| D1 | **独立 priv** | `platform-catalog:manage` 覆盖注册/审核/下线全部写入口（单一管理 priv，不拆审核面）；ucenter 权限点建档=运维前置（点不存在时 hasPriv 全员 false——**含管理员**，reject 面先行可测，allow 面等权限数据就位，同 P-8 家规） |
| D2 | 按建议 | 首批 2~3 子系统（learoad/raisef/callin 现有 read 技能升格）10~20 条 |
| D3 | **复用 xxzx_common** | 域简介进该频道 sysPrompt（改动敏感面：默认关开关 `featureCatalog.enabled` 分叉，关时 sysPrompt 逐字现网——对齐"频道不新开、行为可回退"）；platform_features 工具按开关注入 |
| D4 | **$wujie 主应用路由形态** | `entry.url` = 主应用访问链接（活码 `console/src/pages/Apps/Jump.tsx` + `app.tsx:65-72`：`/sub/{clientCode}` 或 visitPath 主应用路由规则）——**禁子应用直链**（旁路主应用=丢登录态/wujie 上下文/权限守卫）；主应用内部功能用主应用自身路由（`/home`、`/personal`、`/apps`）；**privs 两层模型（同日属主修正）**：`{clientCode}-browse`=入口门，子系统内功能项另有功能级 priv——两道合取，见下 §9 权限两层模型 |
| D5 | 复用 approval | 写面确认走调研线 approval 气泡语义（四端 provider 已消费，不造第五种题面协议） |
| D6 | 自动转 pending | 探针判死 ⇒ `reviewStatus=pending` 自动下线 + runStats 吵（宁缺勿死链） |

### 裁定后新增的两条能力需求（同日属主令）

**N1 主应用本身入册**：portal 主应用功能（首页/个人中心/应用市场/消息…）入目录；**clientCode 不硬编**（部署可能注册为 xxzx/micro/…）——取 conf env `featureCatalog_mainClientCode`（Phase 1 落地），主应用条目与 wujie 子应用同表同两层权限面（主应用静态菜单项=guide 级条目现成种子）。

**N2 机制同步底座（micro-platform）**：目录字段扩展、注册面收权、`platform_features` 工具、装配过滤——整套属**底座能力**（方案本身平台无关：目录是各平台自己的数据）。落地节奏=母本每刀判据+接线+探针，底座同刀镜像（既有镜像家规，含"测试文件用例数一起核"红线）；xxzx 侧与底座侧各自登记各自目录，共用同一套治理与消费代码。

### 权限两层模型（2026-11-23 属主修正，覆盖初稿"privs 默认挂 browse"的混谈）

ucenter 权限系在本平台是**两层**的，目录判据必须分家：

```
条目可见/可用 = (browseGate ⇒ hasPriv("{clientCode}-browse"))   ← 入口门（子系统级）
              ∧ hasPriv(∀ p ∈ featurePrivs)                      ← 功能级（子系统内细粒度，可空）
```

- **入口门**：`{clientCode}-browse` = "可以访问该子系统"（主应用菜单同源，`app.tsx:71`）。目录条目**不重复登记 browse**——由 `browseGate`（注册时同步 client 注册表 `needAuth2Show` 的事实）+ 条目 `clientCode` 推导，两处登记必分叉（D66 同源纪律）。`browseGate` 缺省/老数据 ⇒ 保守按 `true` 处理（入口制平台默认严）。
- **功能级**：子系统内功能项可另有权限标识（如报表管理、审核类 priv），存 `featurePrivs`；空=入口内公共。**"菜单可见=AI 可推荐"只在无功能级细粒度时成立**——声明了 featurePrivs 的条目，两道都要过。
- 防线 1（装配过滤）与防线 2（执行复验）**吃同一个合取判据纯件**（Phase 1 落 `decideFeatureAccess`，两处共用防漂移——与 skillGovernance 的 normalizeReviewStatus 同款单源纪律）。
- **主应用 clientCode 不硬编**（D4/N1 修正）：主应用本身可能注册为 clientCode=`xxzx`/`micro`/…（部署而定）。主应用功能条目的入口门同样走"该 clientCode 的 browse（若注册表如此）"；实现上 `platform_features` 的装配上下文必须带**当次部署的主应用 clientCode 配置**（conf env，如 `featureCatalog_mainClientCode`），代码里不许出现字面 'main'。

## 10. 与既有各线的边界声明

- **vs grpcSkill 现状**：不是替换是收编——8 个在册技能=Phase 2 的存量种子（补 featurePrivs/effectClass/description 后升格为目录条目）。**存量迁移义务（V10）**：effectClass 缺省 guide ⇒ 升级落库后这 8 条会"从被调用降级为只被推荐"——Phase 2 前置=人工逐条核定 effectClass/featurePrivs/browseGate 的迁移脚本（dry-run/confirm 形制），核定前装配面对无 effectClass 的存量行**按原行为直通**（不因容器字段缺省而改变现网调用面——"默认关=现网"纪律在存量数据上的镜像）。
- **vs skillWrite P5**：P5 是"闸"，本方案 Phase 3 是"过闸的第一批活物"；开闸批与 write 条目上架**同批互锁**（名单空=闸零载的现状，正是为这一天留的）。
- **vs 编排线（fan-out）**：B3 预留面，当前唯一交集=若用户从任务模式进，功能调用作为 child 工具出现（工具装配天然覆盖，无需改编排判据）。
- **vs 记忆线 constraints**：permission 类约束的渲染纪律（整条进出/出槽 violations）作为目录过滤进 prompt 的性格模板；两系统不合并（一个是"用户给 AI 的规矩"，一个是"平台给用户的门"）。
- **vs callin 调研线**：其 approval/澄清协议是本方案 B2 确认面的先例与复用对象；research V2 频道不在 platform_assistant 范围（各频道自持目录集）。### B0 三条执行铁律（2026-11-23 核查修订 V1/V2/V3——read/write 共同的上位纪律）

1. **身份参数强制覆盖（V1）**：invoke 参数中的身份类字段（userCode/工号/发起人归属）一律由服务端
   以**会话 userCode 覆写**，模型给值不采信（比对不一致则拒并留痕）。这不是假想敌：在册
   `user-score`/`user-info` 技能入参就是工号，现状仅靠模型自觉——AI 替身取他人数据是最高危
   一条，**Phase 1 装配前必须先落**（判据件：paramsSchema 的身份字段标注 `x-identity: true`，
   执行壳统一覆写）。身份字段清单按子系统评审登记，漏标=漏洞。
2. **确认参数冻结（V2）**：write 提案生成时把完整参数快照+哈希落库（随 answerKey=toolCallId 锚），
   执行**只认存档参数**——提案回显与执行之间隔着模型的另一次生成，"确认 A 执行 B"是
   approval 语义的致命伤；哈希不符=拒绝执行并记审计。
3. **写面任务级幂等（V3）**：`${runCode}:${toolCallId}` 只防"同 run 崩溃重放"；**编排 retry=
   新行新 runCode ⇒ journal 必 miss ⇒ 外部动作双跑**。因此进入 Phase 3 名单的 write 条目
   **一律 `idemKeyPolicy:'explicit'`**，键=功能业务级（如 conversationCode+featureCode+关键参数
   哈希），跨 run/跨 retry 稳定；per-run 键型不许进名单。

### B3 多步组合

**已知窗登记（V5，2026-11-23 核查）**：`browseGate` 是注册时从 client 注册表同步的快照——事后子系统改 `needAuth2Show`，目录不会自动跟上（skillMDHash 只护 skillMD 正文）。处置：①审核 checklist 增加"clientCode 注册表配置变更需触发该码全部条目复审"；②探针族增加 browse 一致性对账（低频，逐 clientCode 对比注册表现值与条目 browseGate，不一致记 runStats 不自动改库——权限面自动改动=治理事故）。

## 11. 核查轮记录（2026-11-23，属主"再核查漏洞"令）

攻击性自查产出 10 处漏洞，全部已修订入正文：V1 身份参数冒充（**现状即暴露**：user-score/user-info 入参工号靠模型自觉——B0-1+红线+子系统侧参数收口义务）、V2 确认参数漂移（B0-2 冻结）、V3 编排 retry 幂等穿透（B0-3 explicit 门槛）、V4 存在性 oracle（miss 统一形状）、V5 browseGate 快照漂移（已知窗+对账不自动改库）、V6 探针误杀（401/403=活着+连续两轮）、V7 降级错话（permission-service-unavailable 与"没有"分态）、V8 装配 RPC 放大（run 级批量快照）、V9 审计人/AI 不分（actorKind+identityOverridden）、V10 存量 8 技能默认 guide 的调用面退化（迁移前置+缺省直通）。

**V1 的严重性单独标注：这不是"方案将来要做"，是"今天 dev 在册技能已经裸奔"——Phase 1 首刀前先评估是否把身份覆写单独提前（建议：随 platform_features 同刀，因为检索让"该洞"从单点变成可发现面）。**
