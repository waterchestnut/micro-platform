import {Outlet, useModel} from '@umijs/max'
import {ConfigProvider, theme} from 'antd'
import {useRouteProps} from '@umijs/max'
import {createStyles} from 'antd-style'

const useStyles = createStyles(({token, css}) => {
  return {
    container: css`
      padding-block: 32px;
      padding-inline: 40px;
    `,
  }
})

export default function PersonalLayout() {
  const routeProps = useRouteProps()
  const {initialState} = useModel('@@initialState')
  const {currentUser} = initialState || {}

  const {styles} = useStyles()

  return <div className={styles.container}><Outlet/></div>
}
