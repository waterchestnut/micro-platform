import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

/**
 * file-viewer 3.x runtime-only 渲染器资产落位插件(2026-11-16 升级)。
 *
 * 3.x 不再把 pdfjs worker/cmaps/字体打进主包(1.x 一体化形态),
 * 运行时按 core 的 DEFAULT_FILE_VIEWER_*_PATH 常量从站点根 `/vendor/...` 拉取;
 * 资产文件随各 renderer npm 包发布, 本插件在 build 收尾时复制到 outDir。
 * 缺失后果: PDF 渲染 404(本升级轮浏览器实测抓到)、CJK/基础字体与 xlsx 大表 worker 降级。
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = (p: string) => path.join(root, 'node_modules', '@file-viewer', p)

const FILES = [
  ['renderer-pdf/dist/vendor/pdfjs/legacy/build/pdf.worker.mjs', 'vendor/pdf/pdf.worker.mjs'],
  ['renderer-spreadsheet/dist/worker/sheet.worker.js', 'vendor/xlsx/sheet.worker.js'],
]
const DIRS = [
  ['renderer-pdf/dist/vendor/pdfjs/cmaps', 'vendor/pdf/cmaps'],
  ['renderer-pdf/dist/vendor/pdfjs/standard_fonts', 'vendor/pdf/standard_fonts'],
  ['renderer-pdf/dist/vendor/pdfjs/wasm', 'vendor/pdf/wasm'],
]

export function fileViewerAssetsPlugin(): Plugin {
  return {
    name: 'file-viewer-assets',
    apply: 'build' as const,
    closeBundle() {
      const out = path.resolve(root, 'dist')
      const missing = []
      for (const [src, dest] of FILES) {
        const s = pkg(src)
        if (!fs.existsSync(s)) { missing.push(src); continue }
        const d = path.join(out, dest)
        fs.mkdirSync(path.dirname(d), { recursive: true })
        fs.copyFileSync(s, d)
      }
      for (const [src, dest] of DIRS) {
        const s = pkg(src)
        if (!fs.existsSync(s)) { missing.push(src); continue }
        fs.cpSync(s, path.join(out, dest), { recursive: true })
      }
      if (missing.length) {
        this.error('[file-viewer-assets] 缺少渲染器资产包(检查 @file-viewer/renderer-* 依赖): ' + missing.join(', '))
      }
      console.log('[file-viewer-assets] vendor assets -> dist/vendor/')
    },
  }
}
