import React, {useMemo, useState, useEffect, useRef, useCallback} from 'react'

import EmbedPDF from 'embedpdf-snippet-i18n'
import {getAIIconHtml} from '@/icons/ai'
import {getTransIconHtml} from '@/icons/trans'
import {getSaveIconHtml} from '@/icons/save'
import {uuidV4} from '@/utils/util'
import {useModel} from '@@/exports'
import {getArrowLeftIconHtml} from '@/icons/arrowLeft'
import {history} from '@umijs/max'
import {CaptureData} from 'embedpdf-snippet-i18n/dist/components/capture'
// @ts-ignore
import {CapturePlugin} from '@embedpdf/plugin-capture'

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
  const viewerRef = useRef<HTMLDivElement>(null)
  const {initialState} = useModel('@@initialState')
  const {currentUser} = initialState || {}

  const styles = `:host {
  --color-blue-50: oklch(0.9689 0.0152 22.39);
  --color-blue-100: oklch(0.8884 0.0586 24.81);
  --color-blue-200: oklch(0.8061 0.1102 23.18);
  --color-blue-300: oklch(0.7309 0.1655 23.3);
  --color-blue-400: oklch(0.6732 0.2143 24.47);
  --color-blue-500: oklch(0.621 0.2381 26.07);
  --color-blue-600: oklch(0.5434 0.2132 25.86);
  --color-blue-700: oklch(0.4632 0.1845 25.23);
  --color-blue-800: oklch(0.3825 0.1547 23.89);
  --color-blue-900: oklch(0.3002 0.1207 20.69);
  --color-blue-950: oklch(0.3002 0.1207 20.69);
}`

  let pluginRegistry: any = null

  useEffect(() => {
    if (!viewerRef.current) return

    const loadEmbedPDF = async () => {
      try {

        EmbedPDF.init({
          type: 'container',
          target: viewerRef.current!,
          src: pdfUrl || `${viewerBaseUrl}/demo/368653411.pdf`,
          name: pdfName || `${uuidV4()}.pdf`,
          id,
          worker: true,
          plugins: {
            annotation: {annotationAuthor: currentUser?.realName || '匿名用户'},
            loader: {}
          },
          wasmUrl: `${viewerBaseUrl}/pdfium.wasm`,
          textSelectionMenuExtActions: [
            {
              id: 'action-ai',
              imgNode: getAIIconHtml({className: 'h-5 w-5'}),
              onClick: async (text, selection) => {
                console.log(text, selection)
                let results = await text?.toPromise()
                const textStr = results?.length ? results.join('\r\n') : ''
                onAIAnalysisAction && onAIAnalysisAction(textStr)
              },
              label: 'AI解读'
            },
            {
              id: 'action-translation',
              imgNode: getTransIconHtml({className: 'h-5 w-5'}),
              onClick: async (text, selection) => {
                console.log(text, selection)
                let results = await text?.toPromise()
                const textStr = results?.length ? results.join('\r\n') : ''
                onTransAction && onTransAction(textStr)
              },
              label: '翻译'
            }
          ],
          styles,
          locale: 'zh-CN',
          onInitialized: (registry) => {
            pluginRegistry = registry
            // @ts-ignore
            registry?.getPlugin('loader')?.provides()?.onDocumentLoaded((document: any) => {
              /*console.log(document)*/
            })
            // @ts-ignore
            registry?.getPlugin('loader')?.provides()?.onFileOpened((file: File) => {
              /*console.log(file)*/
              onFileOpened && onFileOpened(file)
            })
          },
          headerEndExtActions: [
            {
              imgNode: '截图AI解析',
              onClick: async () => {
                // @ts-ignore
                const capture = pluginRegistry.getPlugin<CapturePlugin>('capture')?.provides()
                if (!capture) return

                if (capture.isMarqueeCaptureActive()) {
                  capture.disableMarqueeCapture()
                } else {
                  capture.enableMarqueeCapture()
                }
              },
              label: '截取图表等非文本区域，AI帮您分析'
            },
            {
              imgNode: getSaveIconHtml({className: 'h-5 w-5'}),
              onClick: async () => {
                const data = await pluginRegistry?.getPlugin('export')?.saveAsCopyAndGetBufferAndName().toPromise()
                /*console.log(data)*/
                onSaveAnnotation && onSaveAnnotation(data.buffer, data.name)
              },
              label: '保存批注'
            }
          ],
          headerStartExtActions: [{
            imgNode: getArrowLeftIconHtml({className: 'h-5 w-5'}),
            onClick: () => {
              history.back()
            },
            label: '返回'
          }],
          captureExtActions: [
            {
              id: 'capture-action-ai',
              imgNode: 'AI解析',
              onClick: async (data) => {
                const fileData = await pluginRegistry?.getPlugin('export')?.saveAsCopyAndGetBufferAndName().toPromise()
                onCaptureAIAnalysisAction && onCaptureAIAnalysisAction(data, fileData.name)
              },
              label: 'AI帮您分析截图中的内容'
            },
            {
              id: 'capture-action-translation',
              imgNode: getTransIconHtml({className: 'h-5 w-5'}),
              onClick: async (data) => {
                const fileData = await pluginRegistry?.getPlugin('export')?.saveAsCopyAndGetBufferAndName().toPromise()
                onCaptureTransAction && onCaptureTransAction(data, fileData.name)
              },
              label: '翻译'
            }
          ],
        })
      } catch (error) {
        console.error('Failed to load EmbedPDF:', error)
      }
    }

    loadEmbedPDF()
  }, [])

  return (
    <div
      id='pdf-viewer'
      className={className}
      style={{
        height: '100%',
        ...style,
      }}
      ref={viewerRef}
    />
  )
}
