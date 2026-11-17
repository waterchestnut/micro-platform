import React, {useEffect, useRef} from 'react'

import {
  composeLayout,
  FORK_ICONS,
  init,
  nativeFallbackFonts,
  saveAnnotationsCommand,
  selectionActions,
  snapshotActions,
  type SnippetHandle,
  type SnapshotData,
} from 'embedpdf-snippet-i18n'
import {uuidV4} from '@/utils/util'
import {getTheme} from '@/utils/runtimeTheme'
import {useModel} from '@@/exports'
import {history} from '@umijs/max'

export type {SnapshotData}

interface PDFViewerProps {
  pdfUrl: string
  pdfName: string
  id?: string
  style?: React.CSSProperties
  className?: string
  onTransAction?: (text?: string) => void
  onCaptureTransAction?: (data: SnapshotData, documentName: string) => void
  onAIAnalysisAction?: (text?: string) => void
  onCaptureAIAnalysisAction?: (data: SnapshotData, documentName: string) => void
  onSaveAnnotation?: (buffer: Uint8Array, fileName: string) => void
  onFileOpened?: (file: File) => void
}

// v3.x 的 wasm/字体等静态资源与 pdfviewer.console 同源部署（版本必须与 embedpdf-snippet-i18n 匹配）
// @ts-ignore
const viewerBaseUrl = PDF_VIEWER_BASE

export default function PDFViewer(props: PDFViewerProps) {
  const {
    pdfUrl,
    pdfName,
    style,
    className,
    onTransAction,
    onAIAnalysisAction,
    onSaveAnnotation,
    onFileOpened,
    onCaptureAIAnalysisAction,
    onCaptureTransAction,
  } = props

  const containerRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<SnippetHandle | null>(null)

  const {initialState} = useModel('@@initialState')
  const {currentUser} = initialState || {}

  // 回调经 ref 承载：查看器只初始化一次，按钮按最新闭包执行。
  const cbRef = useRef({onTransAction, onAIAnalysisAction, onSaveAnnotation, onFileOpened, onCaptureAIAnalysisAction, onCaptureTransAction})
  cbRef.current = {onTransAction, onAIAnalysisAction, onSaveAnnotation, onFileOpened, onCaptureAIAnalysisAction, onCaptureTransAction}

  useEffect(() => {
    const containerElement = containerRef.current
    if (!containerElement) return

    const fileName = pdfName || `${uuidV4()}.pdf`
    const theme = getTheme()

    // 选中文字的 AI 解读 / 翻译（v2 custom.selection.*，浮动条按钮自动前置）
    const sel = selectionActions([
      {
        id: 'custom.selection.ai',
        label: 'AI解读',
        icon: 'custom_ai',
        onText: (text) => cbRef.current.onAIAnalysisAction?.(text),
      },
      {
        id: 'custom.selection.trans',
        label: '翻译',
        icon: 'custom_trans',
        onText: (text) => cbRef.current.onTransAction?.(text),
      },
    ])

    // 截图框选后的扩展按钮（v2 captureExtActions）
    const snap = snapshotActions([
      {
        id: 'custom.capture.ai',
        label: 'AI解读',
        icon: 'custom_ai',
        onSnapshot: (data) => cbRef.current.onCaptureAIAnalysisAction?.(data, fileName),
      },
      {
        id: 'custom.capture.trans',
        label: '翻译',
        icon: 'custom_trans',
        onSnapshot: (data) => cbRef.current.onCaptureTransAction?.(data, fileName),
      },
    ])

    // 保存批注：导出含未保存变更的副本 bytes（v2 saveAsCopyAndGetBufferAndName）
    const save = saveAnnotationsCommand(
      (buffer, name) => cbRef.current.onSaveAnnotation?.(buffer, name),
      'custom.toolbar.save',
    )

    // 返回按钮（v2 custom.toolbar.back）
    const back = {
      id: 'custom.toolbar.back',
      label: '返回',
      icon: 'custom_back',
      run: () => history.back(),
    }

    const handle = init({
      target: containerElement,
      documents: [{src: pdfUrl || `${viewerBaseUrl}/demo/368653411.pdf`, name: fileName, active: true}],
      maxDocuments: 5,
      engine: {
        wasmUrl: `${viewerBaseUrl}/embedpdf.wasm?v=3.3.0`,
        fallbackFonts: nativeFallbackFonts(`${viewerBaseUrl}/DroidSansFallbackFull.ttf`),
      },
      identity: {displayName: currentUser?.realName || '匿名用户'},
      locale: 'zh-CN',
      theme: {
        preference: 'light',
        // 随主题切换（docs/08 §5.4）：theme.json.pdfEngine.primary 缺省时回落现网旧值
        accent: theme.pdfEngine?.primary || '#08979c',
      },
      icons: { ...FORK_ICONS },
      commands: [...sel.commands, ...snap.commands, save, back],
      // v2 的 mergeSchema 工具栏注入：隐藏标签栏，左侧返回，右侧保存 + 截图工具
      layout: composeLayout(sel.layout, snap.layout, (base) =>
        base
          .tabs('never')
          .add(back.id, {to: 'main', before: 'menu:document'})
          .add(save.id, {to: 'main', section: 'end'})
          .add('tool:snapshot', {to: 'main', section: 'end'}),
      ),
      // v2 docManager.onFileSelected：本地文件选择事件（Open 菜单/Mod+O/拖放）
      onFileSelected: (file) => cbRef.current.onFileOpened?.(file),
    })

    handleRef.current = handle

    return () => {
      handle.destroy()
      handleRef.current = null
    }
  }, [])

  return (
    <div
      id='pdf-viewer'
      className={className}
      style={{
        height: '100%',
        ...style,
      }}
      ref={containerRef}
    />
  )
}
