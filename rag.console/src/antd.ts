// 由 cw2pc-workspace/scripts/sync-brand.mjs 分发，勿手改（docs/08 §5.2）
// 运行时覆盖 ConfigProvider theme token：cssVar 模式下整套 --ant-* 变量随主题重生成
import type {RuntimeAntdConfig} from '@umijs/max'
import {applyThemeDomOnce, getTheme} from '@/utils/runtimeTheme'

export const antd: RuntimeAntdConfig = (memo) => {
    applyThemeDomOnce()
    const t = getTheme()
    memo.theme = memo.theme ?? {}
    memo.theme.token = {...(memo.theme.token ?? {}), ...(t.antd?.token ?? {})}
    return memo
}
