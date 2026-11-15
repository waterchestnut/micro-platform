/**
 * @fileOverview cron 定时首跑/历跑日志读数仪（k8s 观测面，排班窗的正证）
 * @module evals/platform-probes/cron-runs-read
 * @description
 * cron 任务（sleepTime/reconcile/backfill）的"触发完成"日志只在 cron pod 里，
 * 之前这个观测面够不着——排班开了只能"等明天再确认"。kubeconfig（423pc）到手后
 * 这一格补上了：直接读 `deploy/llm-api-cron-retention` 的容器日志，
 * 按任务名把注册行与触发完成行归成一份 JSON 读数。**只读日志，零写。**
 * 用法（任意目录）：node evals/platform-probes/cron-runs-read.mjs [--since=12h] [--kubeconfig=路径]
 * 输出：每个任务的 registered(nextDate) + fires(触发完成行原文的 JSON 段)；
 *       有"任务异常"行时单列 anomalies——首跑确认看 fires，排障看 anomalies。
 */
import {execFileSync} from 'node:child_process'

const argv = process.argv.slice(2)
const val = (n, d) => {
    const hit = argv.find((a) => a.startsWith(`--${n}=`))
    return hit ? hit.slice(n.length + 3) : d
}
const KUBECONFIG = val('kubeconfig', 'C:/Users/menglb/Downloads/423pc.yaml')
const SINCE = val('since', '12h')

function klogs() {
    return execFileSync('kubectl', ['logs', 'deploy/llm-api-cron-retention', '-n', 'xxzx', '--since=' + SINCE, '--tail=4000'],
        {env: {...process.env, KUBECONFIG}, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 60000})
}
const lines = klogs().split(/\r?\n/)
const out = {since: SINCE, total: lines.length, tasks: {}}
const TASKS = ['retention', 'agentTaskRecover', 'abandonedBackfill', 'sleepTimeConsolidate', 'artifactReconcile']
for (const t of TASKS) {
    const reg = lines.filter((l) => l.includes(`cron/${t} 已注册`))
    const off = lines.filter((l) => l.includes(`cron/${t} 未启用`))
    const fires = lines.filter((l) => l.includes(`${t} 触发完成`))
    const skip = lines.filter((l) => l.includes(`${t}-任务仍在执行，跳过`))
    const err = lines.filter((l) => l.includes(`${t} 任务异常`))
    out.tasks[t] = {
        registered: reg.map((l) => (l.match(/(已注册|未启用).*/) || [''])[0].slice(0, 140)),
        disabled: off.length,
        fires: fires.map((l) => {
            const j = l.indexOf('{')
            if (j < 0) return l.slice(0, 160)
            try { return JSON.parse(l.slice(j)) } catch { return l.slice(0, 160) }
        }),
        overlaps: skip.length,
        anomalies: err.map((l) => l.slice(0, 240)),
    }
}
console.log(JSON.stringify(out, null, 1))
