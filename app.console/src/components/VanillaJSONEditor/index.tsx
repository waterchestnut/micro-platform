import {
  createJSONEditor,
  JSONEditorPropsOptional,
  JsonEditor,
} from 'vanilla-jsoneditor'
import React, {useEffect, useRef} from 'react'
import {createStyles} from 'antd-style'

const useStyles = createStyles(({token}) => {
  return {
    wrapper: {
      display: 'flex',
      flex: 1,
      '--jse-theme-color': token.colorPrimary,
      '--jse-theme-color-highlight': token.colorPrimaryActive
    },
  }
})

function filterUnchangedProps(
  props: JSONEditorPropsOptional,
  prevProps: JSONEditorPropsOptional
): JSONEditorPropsOptional {
  return Object.fromEntries(
    Object.entries(props).filter(
      ([key, value]) =>
        value !== prevProps[key as keyof JSONEditorPropsOptional]
    )
  )
}


const VanillaJSONEditor: React.FC<JSONEditorPropsOptional> = (props) => {
  const refContainer = useRef<HTMLDivElement | null>(null)
  const refEditor = useRef<JsonEditor | null>(null)
  const refPrevProps = useRef<JSONEditorPropsOptional>(props)
  const {styles} = useStyles()

  useEffect(() => {
    // create editor
    //console.log('create vanilla editor', refContainer.current)
    refEditor.current = createJSONEditor({
      target: refContainer.current as HTMLDivElement,
      props,
    })

    return () => {
      // destroy editor
      if (refEditor.current) {
        //console.log('destroy vanilla editor')
        refEditor.current.destroy()
        refEditor.current = null
      }
    }
  }, [])

  // update props
  useEffect(() => {
    if (refEditor.current) {
      // only pass the props that actually changed
      // since the last time to prevent syncing issues
      const changedProps = filterUnchangedProps(props, refPrevProps.current)
      //console.log('update vanilla props', changedProps)
      refEditor.current.updateProps(changedProps)
      refPrevProps.current = props
    }
  }, [props])

  return <div className={styles.wrapper} ref={refContainer}></div>
}

export default VanillaJSONEditor
