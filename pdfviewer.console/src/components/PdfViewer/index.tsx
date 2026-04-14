import React, {useMemo, useState, useEffect, useRef, useCallback} from 'react'

import EmbedPDF, {
  type EmbedPdfContainer,
  type PDFViewerConfig,
  type PluginRegistry,
  buildCdnFontConfig,
} from 'embedpdf-snippet-i18n'
import {getAIIconPaths} from '@/icons/ai'
import {getTransIconPaths} from '@/icons/trans'
import {uuidV4} from '@/utils/util'
import {useModel} from '@@/exports'
import {getArrowLeftIconPaths} from '@/icons/arrowLeft'
import {history} from '@umijs/max'
import {CaptureData} from 'embedpdf-snippet-i18n/dist/components/capture'

interface PDFViewerProps {
  pdfUrl: string
  pdfName: string
  id?: string
  style?: React.CSSProperties
  className?: string
  onTransAction?: (text?: string) => void
  onCaptureTransAction?: (data: CaptureData, documentName: string) => void
  onAIAnalysisAction?: (text?: string) => void
  onCaptureAIAnalysisAction?: (data: CaptureData, documentName: string) => void
  onSaveAnnotation?: (buffer: any, fileName: string) => void
  onFileOpened?: (file: File) => void
}

// @ts-ignore
const viewerBaseUrl = PDF_VIEWER_BASE

export default function PDFViewer(props: PDFViewerProps) {
  const {
    id,
    pdfUrl,
    pdfName,
    style,
    className,
    onTransAction,
    onAIAnalysisAction,
    onSaveAnnotation,
    onFileOpened,
    onCaptureAIAnalysisAction,
    onCaptureTransAction
  } = props

  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<EmbedPdfContainer | null>(null)

  const {initialState} = useModel('@@initialState')
  const {currentUser} = initialState || {}

  useEffect(() => {
    if (!containerRef.current) return

    let isActive = true
    const containerElement = containerRef.current

    const loadEmbedPDF = async () => {
      let fileName = pdfName || `${uuidV4()}.pdf`
      let fontUrls: any = {};
      ['arabic', 'hebrew', 'jp', 'kr', 'latin', 'sc', 'tc'].forEach(key => {
        fontUrls[key] = `${viewerBaseUrl}/fonts/${key}`
      })
      try {
        const viewer = EmbedPDF.init({
          type: 'container',
          target: containerRef.current!,
          worker: true,
          wasmUrl: `${viewerBaseUrl}/pdfium.wasm?v=2-14-0-1`,
          annotations: {annotationAuthor: currentUser?.realName || '匿名用户'},
          documentManager: {
            maxDocuments: 5,
            initialDocuments: [{
              url: pdfUrl || `${viewerBaseUrl}/demo/368653411.pdf`, documentId: id, name: fileName
            }]
          },
          tabBar: 'never',
          theme: {
            preference: 'light',
            light: {
              accent: {
                primary: '#F5222D',        // Main brand color
                primaryHover: '#cf1322',   // Hover state
                primaryActive: '#a8071a',  // Click state
                primaryLight: '#f3e8ff',   // Subtle backgrounds (e.g., selection)
                primaryForeground: '#fff'  // Text on top of primary color
              }
            },
          },
          i18n: {
            defaultLocale: 'zh-CN'
          },
          icons: {
            custom_ai: getAIIconPaths(),
            custom_trans: getTransIconPaths(),
            custom_arrow_left: getArrowLeftIconPaths(),
          },
          fontFallback: {
            fonts: {
              ...buildCdnFontConfig(fontUrls).fonts
            }
          },
          captureExtActions: [
            {
              id: 'custom.capture.ai',
              label: 'AI解读',
              onClick: (captureData: CaptureData) => {
                onCaptureAIAnalysisAction && onCaptureAIAnalysisAction(captureData, fileName)
              }
            },
            {
              id: 'custom.capture.trans',
              label: '翻译',
              onClick: (captureData: CaptureData) => {
                onCaptureTransAction && onCaptureTransAction(captureData, fileName)
              }
            },
          ],
        })

        if (!viewer) {
          return
        }
        viewerRef.current = viewer
        if (!isActive) {
          return
        }
        const registry = await viewer.registry

        const commands = registry.getPlugin('commands')?.provides?.()
        const ui = registry.getPlugin('ui')?.provides?.()
        const schema = ui.getSchema()

        // custom selection
        commands.registerCommand({
          id: 'custom.selection.ai',
          label: 'AI解读',
          icon: 'custom_ai',
          action: async ({registry, documentId}: { registry: PluginRegistry; state: any; documentId: string }) => {
            const plugin = registry.getPlugin('selection')
            const scope = plugin?.provides?.().forDocument(documentId)
            const results = (await scope?.getSelectedText().toPromise()) || []
            /*console.log('AI解读', text)*/
            const textStr = results?.length ? results.join('\r\n') : ''
            onAIAnalysisAction && onAIAnalysisAction(textStr)
            scope?.clear()
          },
          categories: ['selection'],
        })
        commands.registerCommand({
          id: 'custom.selection.trans',
          label: '翻译',
          icon: 'custom_trans',
          action: async ({registry, documentId}: { registry: PluginRegistry; state: any; documentId: string }) => {
            const plugin = registry.getPlugin('selection')
            const scope = plugin?.provides?.().forDocument(documentId)
            const results = (await scope?.getSelectedText().toPromise()) || []
            /*console.log('翻译', text)*/
            const textStr = results?.length ? results.join('\r\n') : ''
            onTransAction && onTransAction(textStr)
            scope?.clear()
          },
          categories: ['selection'],
        })
        const selectionItems = schema.selectionMenus['selection'].items
        ui.mergeSchema({
          selectionMenus: {
            ...schema.selectionMenus,
            selection: {
              ...schema.selectionMenus['selection'],
              items: [
                {
                  type: 'command-button',
                  id: 'custom-selection-ai',
                  commandId: 'custom.selection.ai',
                  variant: 'icon',
                  categories: ['selection'],
                },
                {
                  type: 'command-button',
                  id: 'custom-selection-trans',
                  commandId: 'custom.selection.trans',
                  variant: 'icon',
                  categories: ['selection'],
                },
                ...selectionItems
              ]
            }
          }
        })

        // custom toolbar
        const toolbar = schema.toolbars['main-toolbar']
        commands.registerCommand({
          id: 'custom.toolbar.back',
          label: '返回',
          icon: 'custom_arrow_left',
          action: async ({registry, documentId}: { registry: PluginRegistry; state: any; documentId: string }) => {
            /*console.log('返回')*/
            history.back()
          },
          categories: ['toolbar'],
        })
        commands.registerCommand({
          id: 'custom.toolbar.save',
          label: '保存批注',
          icon: 'save',
          action: async ({registry, documentId}: { registry: PluginRegistry; state: any; documentId: string }) => {
            // @ts-ignore
            const data = await registry.getPlugin('export')?.saveAsCopyAndGetBufferAndName(documentId).toPromise()
            /*console.log(data)*/
            onSaveAnnotation && onSaveAnnotation(data.buffer, data.name)
          },
          categories: ['toolbar'],
        })
        commands.registerCommand({
          id: 'custom.toolbar.capture.ai',
          label: '截图AI解析',
          action: async ({registry, documentId}: { registry: PluginRegistry; state: any; documentId: string }) => {
            const capture = registry.getPlugin('capture')?.provides?.()
            if (!capture) return

            const scope = capture.forDocument(documentId)
            if (scope.isMarqueeCaptureActive()) {
              scope.disableMarqueeCapture()
            } else {
              scope.enableMarqueeCapture()
            }
          },
          categories: ['toolbar'],
        })
        const toolbarItems = JSON.parse(JSON.stringify(toolbar.items))
        const rightGroup = toolbarItems.find((item: any) => item.id === 'right-group')
        const leftGroup = toolbarItems.find((item: any) => item.id === 'left-group')
        /*console.log(toolbarItems, rightGroup, leftGroup)*/
        if (rightGroup) {
          rightGroup.items = rightGroup.items || []
          rightGroup.items.unshift({
            type: 'command-button',
            id: 'custom-toolbar-save',
            commandId: 'custom.toolbar.save',
            variant: 'icon',
            categories: ['toolbar'],
          },)
          rightGroup.items.unshift({
            type: 'command-button',
            id: 'custom-toolbar-capture-ai',
            commandId: 'custom.toolbar.capture.ai',
            variant: 'text',
            categories: ['toolbar'],
          },)
        }
        if (leftGroup) {
          leftGroup.items = leftGroup.items || []
          leftGroup.items.unshift({
            type: 'command-button',
            id: 'custom-toolbar-back',
            commandId: 'custom.toolbar.back',
            variant: 'icon',
            categories: ['toolbar'],
          },)
        }
        ui.mergeSchema({
          toolbars: {'main-toolbar': {...toolbar, items: toolbarItems}}
        })

        const docManager = registry.getPlugin('document-manager')?.provides?.()
        docManager.onDocumentOpened(async (doc: any) => {
          /*console.log(doc)
          const data = await registry?.getPlugin('export')?.saveAsCopyAndGetBufferAndName(doc.id).toPromise()
          console.log(data)*/
        })
        docManager.onFileSelected((file: File) => {
          onFileOpened && onFileOpened(file)
        })
      } catch (error) {
        console.error('Failed to load EmbedPDF:', error)
      }
    }

    loadEmbedPDF()
    return () => {
      isActive = false
      containerElement.innerHTML = ''
      viewerRef.current = null
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
