// 语言切换下拉（由 cw2pc-workspace/scripts/sync-i18n.mjs 分发，勿手改；docs/09）
// 仅支持 zh-CN / en-US；setLocale 写入 localStorage(umi_locale)，软刷新页面
import { GlobalOutlined } from '@ant-design/icons'
import { Dropdown, type MenuProps } from 'antd'
import { setLocale, useIntl } from '@umijs/max'

const langs: Record<string, string> = { 'zh-CN': '简体中文', 'en-US': 'English' }

export default function SelectLang() {
    const intl = useIntl()
    const items: MenuProps['items'] = Object.entries(langs).map(([key, label]) => ({key, label}))
    return (
        <Dropdown
            menu={{
                items,
                selectable: true,
                selectedKeys: [intl.locale],
                onClick: ({key}) => setLocale(String(key), false),
            }}
            placement="bottomRight"
        >
            <span
                title={intl.formatMessage({id: 'navBar.lang', defaultMessage: '语言'})}
                style={{display: 'inline-flex', alignItems: 'center', padding: '0 12px', cursor: 'pointer'}}
            >
                <GlobalOutlined style={{fontSize: 16}}/>
            </span>
        </Dropdown>
    )
}
