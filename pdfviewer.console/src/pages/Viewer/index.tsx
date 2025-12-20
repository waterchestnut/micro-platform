import {PageLoading} from '@ant-design/pro-components'
import {useModel} from '@umijs/max'
import {Button, Tabs, theme, Tooltip, Splitter, ConfigProvider, FloatButton, Result, App, Spin} from 'antd'
import React, {useEffect, useRef, useState} from 'react'
import PDFViewer from '@/components/PdfViewer'
import {createStyles} from 'antd-style'
import {isEmbedded} from '@/utils/embed'
import {CloseOutlined} from '@ant-design/icons'
import AIAnalysisComponent, {AIAnalysisComponentAction} from '@/pages/Viewer/components/AIAnalysis'
import TransComponent, {TransComponentAction} from '@/pages/Viewer/components/Trans'
import {AIIcon} from '@/icons/ai'
import {TransIcon} from '@/icons/trans'
import {useParams, history} from '@umijs/max'
import {checkResLiterature, localFileLiterature} from '@/services/resource/literature'
import {getFileUrl, uuidV4} from '@/utils/util'
import {simpleUniqueUploadFile, uniqueUploadFile} from '@/services/doc/fileInfo'
import dayjs from 'dayjs'
import {CaptureData} from 'embedpdf-snippet-i18n/dist/components/capture'

const useStyles = createStyles(({token, css}) => {
  return {
    container: {
      height: isEmbedded() ? 'calc(100vh - 64px)' : '100%',
      boxShadow: '0 0 10px rgba(0, 0, 0, 0.1)',
      overflow: 'hidden',
    },
    pdfViewer: {
      height: '100%',
      paddingRight: '2px'
    },
    analysisContainer: {
      height: '100%',
      paddingLeft: '2px',
      '.ant-tabs-content-right,.ant-tabs-tabpane': {
        height: '100%',
      }
    },
  }
})

const defaultSizes = ['70%', '30%']

const Viewer: React.FC = () => {
  const {token} = theme.useToken()
  const {initialState} = useModel('@@initialState')
  const {styles} = useStyles()
  const [sizes, setSizes] = React.useState<(number | string)[]>(defaultSizes)
  const [analysisOpen, setAnalysisOpen] = React.useState<boolean>(true)
  const [tabActive, setTabActive] = React.useState<string>('ai')
  const [loading, setLoading] = useState<boolean>(true)
  const [literatureInfo, setLiteratureInfo] = useState<any>(null)
  const [error, setError] = useState<string>('')
  const params = useParams()
  const {message} = App.useApp()
  const [localFileLoading, setLocalFileLoading] = useState<boolean>(false)
  const [localFileTip, setLocalFileTip] = useState<string>('')

  const transRef = useRef<TransComponentAction>(null)
  const aiRef = useRef<AIAnalysisComponentAction>(null)

  const loadLiteratureInfo = async () => {
    if (!params.resCode) {
      return history.push('/404')
    }
    setLoading(true)
    let ret = await checkResLiterature(params.resCode)
    if (ret?.code !== 0 && ret?.msg) {
      setError(ret.msg)
      setLoading(false)
      return
    }
    let info: any = ret?.data
    if (!info?.resCode) {
      return history.push('/404')
    }
    setLiteratureInfo(info)
    setLoading(false)
  }

  useEffect(() => {
    if (!params.resCode) {
      return history.push('/404')
    }
    loadLiteratureInfo()
  }, [params.resCode])

  const onAnalysisClose = () => {
    setAnalysisOpen(false)
  }

  const onAnalysisOpen = (active?: string) => {
    setAnalysisOpen(true)
    if (active) {
      setTabActive(active)
      setSizes(defaultSizes)
    }
  }

  const onTrans = (text?: string) => {
    onAnalysisOpen('trans')
    transRef?.current?.goTrans(text)
  }

  const onAIAnalysis = (text?: string) => {
    onAnalysisOpen('ai')
    aiRef?.current?.goAnalysis(`请结合文献材料解读以下内容：\r\n${text}`)
  }

  const onSaveAnnotation = async (buffer: Buffer, fileName: string) => {
    const blobData = new Blob([new Uint8Array(buffer)], {type: 'application/pdf'})
    const formData = new FormData()
    formData.append('file', blobData, fileName)
    /*console.log(blobData, fileName, formData.get('file'))*/
    let ret = await uniqueUploadFile(literatureInfo.fileList[0].fileCode, formData)
    /*console.log(ret)*/
    if (ret.code !== 0) {
      message.error(`文献批注保存失败 ${ret.msg}`)
      return
    }
    message.info(`文献批注已保存 ${dayjs().format('HH:mm:ss')}`)
    return
  }

  const onFileOpened = async (file: File) => {
    /*console.log(file)*/
    setLocalFileLoading(true)
    setLocalFileTip('文件上传中。。。')
    let fileRet = await simpleUniqueUploadFile(uuidV4(), file)
    if (fileRet.code !== 0) {
      message.error(`文件上传失败 ${fileRet.msg}`)
      setTimeout(() => {
        window.location.reload()
      }, 3000)
      return
    }
    let fileInfo = {
      ...fileRet.data,
    }
    fileInfo.url = `?fileCode=${fileInfo.fileCode}`
    fileInfo.name = fileInfo.fileName
    fileInfo.size = fileInfo.fileSize
    fileInfo.type = file.type
    setLocalFileTip('文献解读预处理。。。')
    let literatureRet = await localFileLiterature(fileInfo)
    if (literatureRet.code !== 0) {
      message.error(`文献解读转存失败 ${literatureRet.msg}`)
      setTimeout(() => {
        window.location.reload()
      }, 3000)
      return
    }
    let resCode = literatureRet.data.resCode
    message.success('文献解读预处理完成，即将开始解读')
    setLocalFileLoading(false)
    setLocalFileTip('')
    setTimeout(() => {
      history.replace(`/viewer/${resCode}`)
    }, 3000)
  }

  const saveCaptureFile = async (captureData: CaptureData, documentName: string) => {
    setLocalFileLoading(true)
    setLocalFileTip('文件上传中。。。')
    const formData = new FormData()
    formData.append('file', captureData.blob, `${documentName.replaceAll(/.pdf/ig, '')}-${captureData.pageIndex + 1}.png`)
    let fileRet = await uniqueUploadFile(uuidV4(), formData)
    setLocalFileLoading(false)
    setLocalFileTip('')
    if (fileRet.code !== 0) {
      message.error(`文件上传失败 ${fileRet.msg}`)
      return null
    }
    return fileRet.data
  }

  const onCaptureAIAnalysisAction = async (captureData: CaptureData, documentName: string) => {
    /*console.log(captureData, documentName)*/
    let fileInfo = await saveCaptureFile(captureData, documentName)
    if (!fileInfo) {
      return
    }
    onAnalysisOpen('ai')
    aiRef?.current?.goAnalysis(`请结合文献材料解读图片中的内容`, [{
      type: 'image_url',
      image_url: {url: getFileUrl(fileInfo)}
    }])
  }

  const onCaptureTransAction = async (captureData: CaptureData, documentName: string) => {
    console.log(captureData, documentName)
    let fileInfo = await saveCaptureFile(captureData, documentName)
    if (!fileInfo) {
      return
    }
    onAnalysisOpen('trans')
    transRef?.current?.goTrans('', getFileUrl(fileInfo))
  }

  if (loading) {
    return (
      <PageLoading
        fullscreen
        tip='文献加载中...'
      />
    )
  }

  if (error) {
    return (
      <Result
        status='500'
        title='文献加载出错'
        subTitle={error}
        extra={<Button type='primary' onClick={() => history.push('/')}>回到首页</Button>}
      />
    )
  }

  if (!literatureInfo?.fileList?.length) {
    return (
      <Result
        status='404'
        title='文献文件未找到'
        subTitle='文献文件未找到，请检查文献访问入口是否正确并联系管理员。'
        extra={<Button type='primary' onClick={() => history.push('/')}>回到首页</Button>}
      />
    )
  }

  return (
    <ConfigProvider
      theme={{
        components: {
          Splitter: {
            splitBarSize: 6,
            splitTriggerSize: 6,
            splitBarDraggableSize: 36
          }
        }
      }}
    >
      {
        localFileLoading ?
          <Spin
            fullscreen
            tip={localFileTip}
          /> : null
      }
      <Splitter
        className={styles.container}
        onResize={setSizes}
        onCollapse={(collapsed, inSizes) => {
          //console.log(collapsed, sizes, inSizes)
          if (collapsed[1]) {
            onAnalysisClose()
          } else {
            onAnalysisOpen()
          }
        }}
      >
        <Splitter.Panel size={sizes[0]} min='40%'>
          <div className={styles.pdfViewer}>
            <PDFViewer
              onTransAction={onTrans}
              onAIAnalysisAction={onAIAnalysis}
              pdfUrl={getFileUrl(literatureInfo.fileList[0])}
              pdfName={literatureInfo.fileList[0].name}
              id={literatureInfo.fileList[0].fileCode}
              onSaveAnnotation={onSaveAnnotation}
              onFileOpened={onFileOpened}
              onCaptureTransAction={onCaptureTransAction}
              onCaptureAIAnalysisAction={onCaptureAIAnalysisAction}
            />
          </div>
        </Splitter.Panel>
        <Splitter.Panel size={sizes[1]} collapsible={{start: true, end: true, showCollapsibleIcon: true}} min='30%'>
          <div className={styles.analysisContainer}>
            <Tabs
              style={{height: '100%', background: '#fff'}}
              tabPosition='right'
              activeKey={tabActive}
              onChange={setTabActive}
              tabBarExtraContent={{
                left:
                  <Tooltip title='收起侧边栏' placement='left'>
                    <Button style={{marginBlock: '12px'}} shape='circle' icon={<CloseOutlined/>} onClick={() => {
                      setSizes((sizes) => ['100%', 0])
                      onAnalysisClose()
                    }}/>
                  </Tooltip>
              }}
              items={[
                {
                  key: 'ai',
                  icon: null,
                  children:
                    <AIAnalysisComponent literatureInfo={literatureInfo} ref={aiRef}/>,
                  label:
                    <Tooltip title='AI解读' placement='left'>
                      <div><AIIcon size={32}/></div>
                    </Tooltip>,
                  forceRender: true,
                },
                {
                  key: 'trans',
                  icon: null,
                  children:
                    <TransComponent ref={transRef}/>,
                  label:
                    <Tooltip title='翻译助手' placement='left'>
                      <div><TransIcon size={32}/></div>
                    </Tooltip>,
                  forceRender: true,
                }
              ]}
            />
          </div>
        </Splitter.Panel>
      </Splitter>
      {
        analysisOpen ? null :
          <FloatButton.Group shape='square'>
            <FloatButton
              tooltip={
                {
                  title: 'AI解读',
                  placement: 'left',
                }
              }
              icon={<AIIcon size={18}/>}
              onClick={() => {
                onAnalysisOpen('ai')
              }}
            />
            <FloatButton
              tooltip={
                {
                  title: '翻译助手',
                  placement: 'left',
                }
              }
              icon={<TransIcon size={18}/>}
              onClick={() => {
                onAnalysisOpen('trans')
              }}
            />
          </FloatButton.Group>
      }
    </ConfigProvider>
  )
}

export default Viewer
