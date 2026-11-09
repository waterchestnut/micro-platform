/**
 * @fileOverview 生成"停机信号实验"用的隔离 pod（不动线上服务）
 * @module evals/platform-probes/gen-sigterm-pod
 * @description
 * P-10 的机理结论必须靠实验拿到才能写，而实验不能直接改线上 deployment。
 * 这个脚本从 dev 的 `llm-api-http` deployment **继承 env**（连的是同一套 dev mongo/redis/relay），
 * 只改四件事：
 * 1. **换 label**（`app=llm-api-sigtest`）——绝不能带 `app=llm-api-http`，
 *    否则 Service 会把真流量分给实验 pod，那就不再是实验而是发布事故；
 * 2. 换端口（13099），不与服务实例抢 12008；
 * 3. `terminationGracePeriodSeconds: 60`，给 close 序列留够时间；
 * 4. **command 覆盖成要验证的入口形态**（`--entry` 决定）。
 *
 * 用法（需 KUBECONFIG 指向 dev 集群）：
 *   node evals/platform-probes/gen-sigterm-pod.mjs --entry=node --grace=20 | kubectl -n xxzx apply -f -
 *   node evals/platform-probes/gen-sigterm-pod.mjs --entry=pm2-runtime | kubectl -n xxzx apply -f -
 *   node evals/platform-probes/gen-sigterm-pod.mjs --entry=image       | kubectl -n xxzx apply -f -  # 复现现状
 * 之后 `kubectl -n xxzx port-forward pod/llm-api-sigtest 13099:13099`，
 * 再跑 `sigterm-runtime-experiment.mjs`。
 */
import {execFileSync} from 'node:child_process'

const argv = process.argv.slice(2)

/**
 * @description 取 `--name=value` 形式的参数值
 * @param {String} n 参数名
 * @param {String} d 默认值
 * @returns {String} 值
 */
function val(n, d) {
    const hit = argv.find(a => a.startsWith('--' + n + '='))
    return hit ? hit.substring(n.length + 3) : d
}

const NAMESPACE = val('ns', 'xxzx')
const DEPLOY = val('deploy', 'llm-api-http')
const ENTRY = val('entry', 'node')
/** grace 必须可调：修法是否有效取决于 grace 容不容得下在途 run 的剩余时间 */
const GRACE = Number(val('grace', 60))

/** 不写死任何本机路径：kubeconfig 必须由环境给 */
if (!process.env.KUBECONFIG) {
    console.error('必须设 KUBECONFIG 环境变量（本脚本不内置集群路径）')
    process.exit(2)
}

/**
 * 三种入口形态（每种都要在运行时里核对，不能看命令行看起来对）：
 * - `image`：镜像原样（`pm2 start` daemon 化 + `tail -f` 当 PID 1）——现状，SIGTERM 到不了 worker
 * - `pm2-runtime`：PID 1 会转发，但 `--kill-timeout` 实测**未被采纳**（`pm2 jlist` 里没有该字段），
 *   worker 仍在 1.6s 量级被 SIGKILL
 * - `node`：PID 1 就是应用，SIGTERM 直达 close-with-grace —— 实测唯一跑通的一种
 */
const ENTRY_CMD = {
    image: null,
    'pm2-runtime': ['/bin/sh', '-c', 'cd /app && exec pm2-runtime --kill-timeout 40000 $APP -i 1'],
    node: ['/bin/sh', '-c', 'cd /app && exec node server.js'],
}[ENTRY]
if (ENTRY_CMD === undefined) {
    console.error(`未知 --entry=${ENTRY}（可用 image | pm2-runtime | node）`)
    process.exit(2)
}

const spec = JSON.parse(execFileSync('kubectl', ['-n', NAMESPACE, 'get', 'deploy', DEPLOY, '-o', 'json'],
    {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024})).spec.template.spec
const c = spec.containers[0]
const env = (c.env || []).filter(e => e.value !== undefined)
env.push({name: 'PORT', value: '13099'})

console.log(JSON.stringify({
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
        name: 'llm-api-sigtest',
        namespace: NAMESPACE,
        labels: {app: 'llm-api-sigtest', 'xxzx-sigtest': 'true'},
    },
    spec: {
        restartPolicy: 'Never',
        nodeSelector: spec.nodeSelector,
        hostAliases: spec.hostAliases,
        tolerations: spec.tolerations,
        imagePullSecrets: spec.imagePullSecrets,
        terminationGracePeriodSeconds: GRACE,
        containers: [{
            name: 'llm-api-sigtest',
            image: c.image,
            env,
            ...(ENTRY_CMD ? {command: ENTRY_CMD} : {}),
            ports: [{containerPort: 13099}],
            securityContext: c.securityContext,
            resources: c.resources,
        }],
    },
}, null, 1))
