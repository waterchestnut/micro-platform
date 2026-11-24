import {useState, useRef, useMemo, useEffect, useCallback, createRef} from 'react'
import {
  Flex,
  Avatar,
  Button,
  theme,
  message,
  Badge,
  type GetProp,
  type GetRef,
  Typography,
  Spin,
  Space,
  Upload,
  Modal,
  Switch,
  Tooltip,
} from 'antd'
import {createStyles} from 'antd-style'
import {
  Bubble,
  Sender,
  Think,
  XProvider,
  BubbleListProps,
  Attachments,
  type AttachmentsProps,
  FileCardProps,
  FileCard,
  BubbleProps,
} from '@ant-design/x'
import {CloudUploadOutlined} from '@ant-design/icons'
import {XMarkdown} from '@ant-design/x-markdown'
import Latex from '@ant-design/x-markdown/plugins/Latex'
import {UserOutlined, RobotOutlined, MessageOutlined, LinkOutlined} from '@ant-design/icons'
import zhCN from 'antd/locale/zh_CN'
import zhCN_X from '@ant-design/x/locale/zh_CN'
import ThinkComponent from '@/pages/Chat/components/ThinkComponent'
import CodeComponent from '@/pages/Chat/components/CodeComponent'
import ConversationList, {
  type Conversation,
  ConversationListAction,
} from '@/pages/Chat/components/ConversationList'
import {getAccessToken, getUserCache} from '@/utils/authority'
import CommonChatProvider, {
  CHANNEL_COMMON,
  asText,
  type CommonChatInput,
  type CommonChatMessage,
  type CommonChatOutput,
} from '@/chatProviders/CommonChatProvider'
import {MessageInfo, useXChat, XRequest} from '@ant-design/x-sdk'
import {getMessageList} from '@/services/llm/message'
import ProcessPanel from '@/pages/Chat/components/ProcessPanel'
import EmptyRoundNotice from '@/pages/Chat/components/EmptyRoundNotice'
import {fromHistorySegments} from '@/chatProviders/segments'
import {regenerateTarget, regenerateConfirmText, regenerateBlockedText} from '@/chatProviders/regenerate'
import {structuredRejectText, LOADING_PLACEHOLDER_TEXT, dropLoadingPlaceholder} from '@/chatProviders/rejectText'
import {readTaskFlowError, taskFlowNoteText, upsertPendingTask, removePendingTask, shouldDropPendingTask, pendingTreeTerminalFromView, type PendingTaskEntry} from '@/chatProviders/taskFlow';
import {makeFetchWithTaskFlow} from '@/chatProviders/taskFlowFetch';
import {projectMessageParts} from '@/chatProviders/messageParts';
import {deriveRunStatus} from '@/chatProviders/runStatus';
import MessageParts, {CollapsibleText} from '@/pages/Chat/components/MessageParts';
import RunStatusBar from '@/pages/Chat/components/RunStatusBar';
import ArtifactWorkspace from '@/pages/Chat/components/ArtifactWorkspace';
import TaskCard from '@/pages/Chat/components/TaskCard';
import {researchTaskDetail, researchTaskCancel, researchTaskClarifyAnswer, researchTaskEventsSubscribe, loadSynthesisBody} from '@/services/llm/agentTask';
import {listConversationArtifacts, readArtifactPage} from '@/services/llm/artifact';
import {makeToolResultLoader} from '@/services/llm/toolResultClient'
import {formatUploadFile, getDocHttpUrl, isArray, uuidV4} from '@/utils/util'

type AttachmentItem = GetProp<AttachmentsProps, 'items'>[number];

const useStyles = createStyles(({token, css}) => ({
  container: css`
    height: calc(100vh - 64px);
    background-color: ${token.colorBgLayout};
  `,
  main: css`
    flex: 1;
    display: flex;
    flex-direction: column;
  `,
  messageList: css`
    flex: 1;
    overflow: auto;
    padding: 24px;
  `,
  messageContainer: css`
    max-width: 1200px;
    margin: 0 auto;

    .ant-bubble-start .ant-bubble-body {
      width: 100%;
    }

    /**
     * 深度美化二轮（属主 2026-11-19，与母本同步）：AI 回答与页面同底色、模块化分层不明显
     * ——回答体=白卡（底/描边/软阴影/14 圆角）从灰底浮起；过程区 header 带=更轻的雾面块，
     * 回答与过程两级层次。
     */
    .ant-bubble-start .ant-bubble-content {
      background: ${token.colorBgContainer};
      border: 1px solid ${token.colorBorderSecondary};
      border-radius: 14px;
      padding: 14px 18px;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.05);
    }
    .ant-bubble-start .ant-bubble-header {
      background: ${token.colorFillQuaternary};
      border-radius: 12px;
      padding: 6px 12px;
    }

    /**
     * 深度美化（属主 2026-11-19，与母本同步）：会话区正文排版层——XMarkdown 输出的
     * 标题/列表/表格/引用/代码此前吃默认值，长答案观感松散。只在气泡内容作用域内收紧。
     */
    .ant-bubble-content {
      font-size: 14px;
      line-height: 1.75;
      word-break: break-word;
    }
    .ant-bubble-content h1,
    .ant-bubble-content h2,
    .ant-bubble-content h3,
    .ant-bubble-content h4 {
      margin: 16px 0 8px;
      font-weight: 600;
      line-height: 1.45;
    }
    .ant-bubble-content h1 {
      font-size: 20px;
    }
    .ant-bubble-content h2 {
      font-size: 18px;
    }
    .ant-bubble-content h3 {
      font-size: 16px;
    }
    .ant-bubble-content ul,
    .ant-bubble-content ol {
      margin: 6px 0 10px;
      padding-inline-start: 22px;
    }
    .ant-bubble-content li {
      margin: 3px 0;
    }
    .ant-bubble-content blockquote {
      margin: 8px 0;
      padding: 2px 12px;
      border-inline-start: 3px solid ${token.colorPrimaryBorder};
      background: ${token.colorFillQuaternary};
      color: ${token.colorTextSecondary};
      border-radius: 0 8px 8px 0;
    }
    .ant-bubble-content table {
      display: block;
      max-width: 100%;
      overflow-x: auto;
      border-collapse: collapse;
      margin: 10px 0;
    }
    .ant-bubble-content th,
    .ant-bubble-content td {
      border: 1px solid ${token.colorBorderSecondary};
      padding: 6px 10px;
      text-align: left;
    }
    .ant-bubble-content th {
      background: ${token.colorFillQuaternary};
      font-weight: 600;
    }
    .ant-bubble-content pre {
      border-radius: 10px;
      margin: 10px 0;
    }
    .ant-bubble-content img {
      max-width: 100%;
      border-radius: 8px;
    }
  `,
  inputArea: css`
    padding: 16px 24px;
    background-color: ${token.colorBgContainer};
    border-top: 1px solid ${token.colorBorder};
  `,
}))

/**
 * 取凭据的写法全页只有一份。
 *
 * 之所以在这里立一个函数而不是再抄一遍：`/core/message/tool-result` 的取回与 SSE 流用的是
 * **同一套凭据**，两处各写一次就意味着"其中一处改了而另一处没改"这种故障。
 * 语义与原先内联实现逐字相同：`param-accessToken` 恒发，dev 环境额外带 `user-info`。
 */
const buildAuthHeaders = (): Record<string, string> => {
  const headers: any = {}
  headers['param-accessToken'] = getAccessToken()
  if (process.env.NODE_ENV === 'development') {
    const userStr: string = getUserCache(false)
    userStr && (headers['user-info'] = userStr)
  }
  return headers
}

const providerCaches = new Map<string, CommonChatProvider>()

/* ---------------- M8 排查刀：在途任务的续跟进账目（刷新不丢"停止/查看"入口） ----------------
 * 键按会话存（会话切走再回来能恢复）。**清理只在事实发生点**：queued=本会话档案已出现同
 * messageCode 行（排水兑现）；accepted=detail 到终局（卡片说完结局那一刻）。"读不到"不删——
 * 观测失败不动账目。恢复只追加缺的跟进气泡（幂等，同 rootCode 在 messages 里已有就不再挂）。 */
const pendingTasksKey = (conv: string) => `chatPendingTasks:${conv || ''}`
function readPendingTasks(conv: string): PendingTaskEntry[] {
  if (!conv) return []
  try {
    const raw = localStorage.getItem(pendingTasksKey(conv))
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list.filter((e: any) => e && e.rootCode && (e.kind === 'accepted' || e.kind === 'queued') && e.note) : []
  } catch {
    return [] // localStorage 不可用=刷新后不自动跟进；卡片文案已如实，不当失败演
  }
}
function writePendingTasks(conv: string, list: PendingTaskEntry[]) {
  if (!conv) return
  try {
    if (list.length) localStorage.setItem(pendingTasksKey(conv), JSON.stringify(list))
    else localStorage.removeItem(pendingTasksKey(conv))
  } catch { /* 同上：存不进去不演成功 */ }
}
const providerFactory = (conversationKey: string) => {
  if (!providerCaches.get(conversationKey)) {
    providerCaches.set(
      conversationKey,
      new CommonChatProvider({
        request: XRequest<CommonChatInput, CommonChatOutput>(
          // @ts-ignore
          `${LLM_API_BASE}/core/chat/stream`,
          {
            manual: true,
            fetch: async (baseURL, options = {}) => {
              /** 刀五（M8 刀一）：受理信封分流包装——判到 taskAccepted/queued 抛可分叉信号，
               *  SSE/拒绝体逐字节透传，现网路径不变（同母本）。 */
              return await makeFetchWithTaskFlow()(baseURL, {
                ...options,
                headers: {
                  ...buildAuthHeaders(),
                  ...options.headers, // 保留原始 headers
                },
              })
            },
          },
        ),
      }),
    )
  }
  return providerCaches.get(conversationKey)
}

const Index: React.FC = () => {
  const {token} = theme.useToken()
  const {styles} = useStyles()
  /** 底座当前用户走 getUserCache（登录时 setUserCache 落库的对象，含 avatarUrl/realName） */
  const currentUser = useMemo<any>(() => {
    try { return getUserCache() || {} } catch { return {} }
  }, [])
  const [activeConv, setActiveConv] = useState<string>('')
  const [inputValue, setInputValue] = useState('')
  const [attachmentsOpen, setAttachmentsOpen] = useState(false)
  const [attachmentItems, setAttachmentItems] = useState<AttachmentItem[]>([])
  const [recording, setRecording] = useState(false)
  /** M8 刀二：任务模式显式开关（属主拍板：不做每条消息自动判定；服务端未开编排时自然落回普通对话） */
  const [taskMode, setTaskMode] = useState<boolean>(false)
  /** 受理信封记账用：本轮预生成 messageCode（queued 兑现凭据=排水后档案同码行） */
  const pendingSendCodeRef = useRef<string>('')
  /** 闭包里的 activeConv 是旧值，等异步回调写账目时用户可能早已切走会话——跟母本同款 ref 镜像 */
  const activeConvRef = useRef<string>(activeConv)
  activeConvRef.current = activeConv
  /** 刀 C：Run 状态条的忙碌计时锚 */
  const [runBusySince, setRunBusySince] = useState<number | null>(null)
  /** 刀 B 工作区唤起态 */
  const [artifactWs, setArtifactWs] = useState<{open: boolean; focusCode: string | null}>({open: false, focusCode: null})
  const openArtifactWorkspace = useCallback((code?: string | null) => setArtifactWs({open: true, focusCode: code || null}), [])
  const [activeConvLabel, setActiveConvLabel] = useState('')
  const listRef = useRef<any>(null)
  const senderRef = useRef<GetRef<typeof Sender>>(null)
  const conversationListRef = createRef<ConversationListAction>()
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const [messageHistory, setMessageHistory] = useState<Record<string, any>>({})
  const [speechSupported, setSpeechSupported] = useState(false)
  const [speechNetworkError, setSpeechNetworkError] = useState(false)

  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      setSpeechSupported(false)
      return
    }
    setSpeechSupported(true)

    const testRecognition = new SpeechRecognition()
    testRecognition.lang = 'zh-CN'
    testRecognition.continuous = true
    testRecognition.interimResults = true

    testRecognition.onerror = (event: any) => {
      if (event.error === 'network') {
        setSpeechNetworkError(true)
      }
    }

    testRecognition.onend = () => {
    }

    try {
      testRecognition.start()
      setTimeout(() => testRecognition.stop(), 1000)
    } catch (e) {
      setSpeechNetworkError(true)
    }
  }, [])

  const reloadMessageList = async (conversationCode: string) => {
    let list = (await getMessageList(1, 20, {conversationCode})).rows || []
    let msgList: React.SetStateAction<MessageInfo<CommonChatMessage>[]> = []
    list.forEach((_: any) => {
      msgList.unshift({
        message: {
          role: 'ai',
          /**
           * 原先是 `${_.answer}`：answer 缺失的行会渲染出字面量 "undefined"（本轮没有正文时就是这个形状，
           * 而"没有正文"恰恰是 EmptyRoundNotice 要解释的那一类，不能先被字符串模板糊掉）。
           */
          content: _.answer ?? '',
          messageCode: _.messageCode,
          attachments: _.answerAttachments,
          answerFeedback: _.answerFeedback,
          answerReasoning: _.answerReasoning,
          // 协议 3 展示视图（message/list 的 process/progress）→ 历史回放同样带过程面板与分段
          fromCache: !!_.answerFromCache,
          process: _.process,
          sources: _.process?.sources || [],
          toolCalls: (_.process?.toolCalls || []).map((t: any) => ({...t, status: 'done'})),
          /** 历史行的段：库里的 `process.segments` 是权威副本，形状在这里归一，组件只消费 */
          segments: fromHistorySegments(_.process?.segments),
          streamState: _.progress === 'abort' ? 'aborted' : _.progress === 'error' ? 'error' : 'done',
          /**
           * `error` 两种进度都要带：`abandoned:` 前缀是判断"这轮是被服务重启打断的"唯一凭据，
           * 只给 error 行的话，回填行的空正文就只能显示成"内容不完整"那种含糊话。
           */
          errorText: _.progress === 'error' || _.progress === 'abort' ? _.error : undefined,
        },
        id: `${_.messageCode}-answer`,
        status: 'success',
        extraInfo: {},
      })
      let queryContent = _.inputs || []
      queryContent.push({type: 'text', text: _.query})
      msgList.unshift({
        message: {
          role: 'my',
          content: queryContent,
          messageCode: _.messageCode,
          attachments: _.attachments,
        },
        id: `${_.messageCode}-query`,
        status: 'success',
        extraInfo: {},
      })
    })

    setMessageHistory((prev) => ({
      ...prev,
      [conversationCode]: msgList,
    }))
    return msgList
  }

  const getDefaultMessages = (conversationKey: string) => {
    let messages = messageHistory[conversationKey] || []
    //console.log(2, conversationKey, messages)
    return messages
  }

  const {messages, onRequest, setMessages, isRequesting, abort} = useXChat({
    conversationKey: activeConv,
    provider: providerFactory(activeConv),
    defaultMessages: getDefaultMessages(activeConv),
    requestFallback: (_, {error, errorInfo, messageInfo}) => {
      //console.log(error, messageInfo)
      if (error.name === 'AbortError') {
        return {
          ...messageInfo.message,
          role: 'ai',
          /** P9：abort 也可能落在正文之前，那时正文就是占位句，不能带进终止态 */
          content: dropLoadingPlaceholder(messageInfo.message?.content),
          streamState: 'aborted',
        } as CommonChatMessage
      }
      /**
       * M8 刀一（刀五移植）：编排受理信封（taskAccepted/queued）——这轮**被收下了**，
       * 不是错误也不是断流。taskNote 走结论行通道（不塞 errorText）；
       * 续跟进账目落 localStorage（排查刀 C：刷新后找回"查看/停止"入口）。
       */
      const taskSig = readTaskFlowError(error)
      if (taskSig) {
        const taskNote = taskFlowNoteText(taskSig.kind, taskSig.payload)
        try {
          const convNow = activeConvRef.current || ''
          writePendingTasks(convNow, upsertPendingTask(readPendingTasks(convNow),
            {kind: taskSig.kind, rootCode: taskSig.payload.rootCode, messageCode: pendingSendCodeRef.current || '', note: taskNote, startedAt: Date.now()}))
        } catch { /* 记账失败不演成功也不拦气泡 */ }
        return {
          ...messageInfo.message,
          role: 'ai',
          content: dropLoadingPlaceholder(messageInfo.message?.content),
          taskNote,
          taskKind: taskSig.kind,
          taskRootCode: taskSig.payload.rootCode,
          streamState: 'done',
        } as CommonChatMessage
      }
      return {
        ...messageInfo.message,
        /**
         * P9（2026-11-13 在 cw2pc 现网实测）：被 4291 拒掉那一轮，头部念出了拒绝原因，
         * 正文却仍是 `requestPlaceholder` 留下的"正在处理，请稍后。。。"，6 秒后还在——
         * 同一句话里既说"被拒了"又说"还在跑"。原来这行 `content || ''` 正是把占位带进终止态的那一步。
         * 判据在 `chatProviders/rejectText.ts`（半截正文不许清空，所以用全等而不是 includes）。
         */
        content: dropLoadingPlaceholder(messageInfo.message?.content),
        /**
         * 拒绝要说得出原因：服务端的拒绝体（`200 + success:false + message`）由 SDK 原样放在
         * `errorInfo` 里交下来，不读它就等于把"你上一条还在收尾"念成"系统坏了"。
         * 判据（含哪些情况不该念）在 `chatProviders/rejectText.ts`，那边有穷举用例。
         */
        errorText: structuredRejectText(errorInfo) || '请求失败 请稍后再试!',
        streamState: 'error',
        role: 'ai',
      } as CommonChatMessage
    },
    requestPlaceholder: () => {
      return {
        /** 与 `dropLoadingPlaceholder` 共用同一个常量：两处各写一遍字面量，改一处就会让终止态清不掉占位 */
        content: LOADING_PLACEHOLDER_TEXT,
        role: 'ai',
      } as CommonChatMessage
    },
  })

  const messagesRef = useRef<MessageInfo<CommonChatMessage>[]>([])
  messagesRef.current = messages

  /**
   * M8 排查刀 C（刀五移植）：进会话时恢复在途任务的跟进气泡（刷新不丢"查看进度/取消"入口）。
   * 清理只在事实点：queued=档案已出现兑现行；accepted=detail 已到终局。
   * detail 读不到 ⇒ 保留条目（观测失败不动账目）；恢复期间用户切走会话 ⇒ 丢弃这次追加。
   */
  const restorePending = useCallback(async (conv: string) => {
    const list = readPendingTasks(conv)
    if (!list.length) return
    const archivedCodes = (messagesRef.current || [])
      .filter((m: any) => m?.message?.role === 'ai')
      .map((m: any) => m?.message?.messageCode || '')
      .filter(Boolean)
    const keep: PendingTaskEntry[] = []
    for (const e of list) {
      let treeTerminal = false
      if (e.kind === 'accepted') {
        try {
          treeTerminal = pendingTreeTerminalFromView(await researchTaskDetail(e.rootCode))
        } catch { treeTerminal = false }
      }
      if (shouldDropPendingTask(e, {archivedMessageCodes: archivedCodes, treeTerminal})) continue
      keep.push(e)
    }
    writePendingTasks(conv, keep)
    if (!keep.length || activeConvRef.current !== conv) return
    setMessages((prev: MessageInfo<CommonChatMessage>[]) => {
      const have = new Set(prev.map((p: any) => p?.message?.taskRootCode).filter(Boolean))
      const adds = keep.filter((e) => !have.has(e.rootCode)).map((e) => ({
        id: `pending-task-${e.rootCode}`,
        message: {
          role: 'ai', content: '', taskNote: e.note, taskKind: e.kind, taskRootCode: e.rootCode, streamState: 'done',
        } as CommonChatMessage,
        status: 'success' as const,
      }))
      return adds.length ? [...prev, ...adds] : prev
    })
  }, [setMessages])
  useEffect(() => {
    if (activeConv) void restorePending(activeConv)
  }, [activeConv, restorePending])

  const doSend = useCallback(
    async (content: string, extra: {regeneratedFrom?: string; attachments?: any[]} = {}) => {
      if (!content.trim() && attachmentItems.length === 0) return

      let messageCode = uuidV4()
      pendingSendCodeRef.current = messageCode // 受理信封记账用（queued 兑现凭据=排水后档案同码行）
      let inputs: any[] = []
      /**
       * P3：重跑必须绕开答案缓存并留下来源。缓存键是 (query, channel, model)，
       * 重跑时三样都没变 ⇒ 不绕开就是把同一条缓存答案再发一遍，按钮看着有效其实无事发生。
       * 服务端见到该键也会绕开；这里显式覆盖是不让界面依赖对方记得自己的规则。
       */
      const regenFrom = typeof extra.regeneratedFrom === 'string' && extra.regeneratedFrom ? extra.regeneratedFrom : ''
      onRequest(
        {
          messages: [
            {
              content: inputs.concat([{type: 'text', text: content}]),
              role: 'my',
              messageCode,
              answerFeedback: 0,
            },
          ],
          conversationCode: activeConv,
          query: content,
          options: {
            channel: CHANNEL_COMMON,
            inputs,
            messageCode,
            /** 重跑复用原问题的附件，否则不是同一件事 */
            attachments: regenFrom
              ? (extra.attachments || []).filter((_: any) => _?.status === 'done')
              : formatUploadFile(attachmentItems).filter((_) => _.status === 'done'),
            enableThinking: 0,
            ...(regenFrom ? {regeneratedFrom: regenFrom, cache: 0} : {}),
            /** §5-1 幂等：每次点"发送"生成一个 taskCode 随请求体固定——双击/网络重发同体 ⇒ 服务端命中同一 rootCode */
            ...(taskMode ? {taskMode: true, taskCode: `t-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`} : {}),
          },
        },
        {extraInfo: {}},
      )

      conversationListRef?.current?.modifyInitLabel(activeConv, content?.slice(0, 20))

      /** 重新生成不清空输入框与附件：那是用户可能正在写的草稿 */
      if (!regenFrom) {
        setInputValue('')
        setAttachmentItems([])
        setAttachmentsOpen(false)
      }
    },
    [attachmentItems, activeConv, conversationListRef, taskMode],
  )

  /**
   * Sender 的 onSubmit 契约是 `(message, slotConfig?, skill?)`：
   * 内部需要能带 `regeneratedFrom` 的形状，但不能把它漏给组件——
   * 否则类型不兼容，只能 `as any`，那是契约分叉的开始。
   */
  const handleSend = useCallback((content: string) => doSend(content, {}), [doSend])

  const handleConversationSelect = async (key: string, item?: any) => {
    isRequesting && abort()
    /**
     * 先置 activeConv 再取历史：pending 新会话的 conversationCode 是前端现生成、服务端尚未创建的，
     * message/list 对它必 403（成员制判定，防枚举，正确）。setActiveConv 若挂在 await 之后，list 抛错
     * → activeConv 停初始 '' → 发送带空 conversationCode → /stream 400。先置保证发送永远拿到合法 code。
     * item.pending=true=本地待创建新会话（无历史）→ 置空历史不发 list，消除 403 往返；其余正常拉。
     */
    setActiveConv(key)
    if (messageHistory?.[key]) return
    if (item?.pending) {
      setMessageHistory((prev) => ({...prev, [key]: []}))
      return
    }
    try {
      await reloadMessageList(key)
    } catch {
      setMessageHistory((prev) => ({...prev, [key]: []}))
    }
  }

  useEffect(() => {
    // history mock
    if (messages?.length) {
      setMessageHistory((prev) => ({
        ...prev,
        [activeConv]: messages,
      }))
    }
  }, [messages])

  const handleNewConversation = useCallback(() => {
    if (isRequesting) {
      message.error(
        '请求正在处理中，请您等待处理完成再创建新的会话；如果想立即创建信息的会话，请先取消当前请求。',
      )
      return false
    }

    if (messageHistory[activeConv]?.length) {
      let newConversation = conversationListRef?.current?.getConvByLabel('新会话')
      if (newConversation) {
        setActiveConv(newConversation.key)
        return false
      }

      const key = uuidV4()
      isRequesting && abort()
      setMessageHistory((prev) => ({...prev, [key]: []}))
      setActiveConv(key)
      return {key: key, label: '新会话', group: '今天'}
    } else {
      message.error('当前已是新会话，无需再次创建。')
      return false
    }
  }, [messageHistory])

  const MAX_FILE_SIZE = 500 * 1024 * 1024 // 500M

  const validateFile = (file: File): boolean => {
    const allowedExtensions = [
      '.pdf',
      '.doc',
      '.docx',
      '.xls',
      '.xlsx',
      '.html',
      '.htm',
      '.md',
      '.txt',
      '.jpg',
      '.jpeg',
      '.png',
      '.gif',
      '.bmp',
      '.webp',
      '.mp3',
      '.wav',
      '.ogg',
      '.aac',
      '.mp4',
      '.avi',
      '.mov',
      '.wmv',
    ]
    const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'))
    if (!allowedExtensions.includes(ext)) {
      message.error('不支持的文件格式')
      return false
    }
    if (file.size > MAX_FILE_SIZE) {
      message.error('文件大小不能超过500M')
      return false
    }
    return true
  }

  const handleAttachmentsChange: AttachmentsProps['onChange'] = async ({file, fileList}) => {
    //console.log(file, fileList)
    if (file.response?.code) {
      message.error(file.response.msg || '上传失败')
      file.status = 'error'
    }
    const updatedFileList = fileList.map((item) => {
      return item
    })
    setAttachmentItems(updatedFileList)
  }


  const getFileCardType = (file: any) => {
    let type = (file.type || '').split('/')[0]
    if (['image', 'audio', 'video'].includes(type)) {
      return type
    }
    return 'file'
  }

  /**
   * P3：能不能重新生成、对哪一条生成，判据在 `chatProviders/regenerate.ts`（穷举测，
   * 含历史载入时"用户消息是分片数组"与跨端角色名两种真实形状）。
   * 不可用时把原因写在按钮旁边，不留哑按钮。
   */
  const regenTarget = useMemo(() => regenerateTarget(messages, {requesting: isRequesting}), [messages, isRequesting])
  const lastAiCode = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i]?.message || {}
      if (m.role === 'ai' && (m.messageCode || messages[i]?.extraInfo?.messageCode)) {
        return m.messageCode || messages[i]?.extraInfo?.messageCode
      }
    }
    return ''
  }, [messages])

  const items: BubbleListProps['items'] = useMemo(
    () =>
      messages.map((item) => ({
        key: item.id,
        role: item.message.role,
        content: item.message.content,
        loading:
          item.status === 'loading' &&
          isRequesting &&
          item.id === messages[messages.length - 1]?.id,
        status: item.status,
        extraInfo: {...item.extraInfo, ...item.message},
        footer: (content, info) => {
          //console.log(info)
          return (
            <div>
              {info.extraInfo?.attachments?.length ? (
                <FileCard.List items={info.extraInfo.attachments.map((_: any) => ({
                  ..._,
                  type: getFileCardType(_),
                  src: getDocHttpUrl(_.url)
                }))}/>
              ) : null}
              {info.extraInfo?.role === 'ai' ? (
                <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                  <label>
                    <Typography.Text type='secondary'>
                      以上内容由AI生成，请注意甄别。
                    </Typography.Text>
                  </label>
                  {(item?.message?.messageCode || item?.extraInfo?.messageCode) === lastAiCode ? (
                    regenTarget.ok ? (
                      <Button
                        size='small'
                        type='text'
                        onClick={() => {
                          /** 先说费用，再说旧答案不删，最后说新答案另起一条 */
                          Modal.confirm({
                            title: '重新生成这条回答',
                            content: regenerateConfirmText(regenTarget),
                            okText: '重新生成',
                            cancelText: '取消',
                            onOk: () => doSend(regenTarget.query || '', {
                              regeneratedFrom: regenTarget.messageCode,
                              attachments: regenTarget.attachments,
                            }),
                          })
                        }}
                      >
                        重新生成
                      </Button>
                    ) : (
                      <Typography.Text type='secondary' style={{fontSize: 12}}>
                        {regenerateBlockedText(regenTarget)}
                      </Typography.Text>
                    )
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        },
      })),
    [messages, isRequesting, token.colorSuccess, token.colorPrimary, regenTarget, lastAiCode, doSend],
  )

  const contentRender: BubbleProps['contentRender'] = (content: any, info) => {
    if (typeof content === 'string') {
      return mdText(content)
    } else if (isArray(content) && content.length) {
      return content.map((item: any, index: number) => {
        if (item.type === 'text') {
          return (
            <div key={index}>
              <XMarkdown
                content={item.text as string}
                components={{
                  think: ThinkComponent,
                  code: CodeComponent,
                }}
                config={{extensions: Latex()}}
                paragraphTag='div'
                protectCustomTagNewlines
              />
            </div>
          )
        } else if (item.type === 'image_url') {
          return (
            <div key={index}>
              <img src={item.image_url.url} alt=''/>
            </div>
          )
        }
        return null
      })
    }
    return ''
  }

  /** 正文渲染单壳（气泡正文/TaskCard 综合正文/工作区预览共用一份 XMarkdown 配置，防两处漂移） */
  const mdText = (t: string) => (
    <XMarkdown
      content={t}
      components={{think: ThinkComponent, code: CodeComponent}}
      config={{extensions: Latex()}}
      paragraphTag="div"
      protectCustomTagNewlines
    />
  )

  /**
   * 刀 C：Run 状态条判据——只折叠页面已有信号（isRequesting + 末条 AI 的 streamState/taskKind），
   * 零新数据源；计时锚立在"转入忙碌"的翻转上。
   */
  const runStatus = useMemo(() => {
    const lastAi = [...messages].reverse().find((m: any) => m?.message?.role === 'ai')?.message
    return deriveRunStatus({requesting: isRequesting, lastAi})
  }, [messages, isRequesting])
  useEffect(() => {
    setRunBusySince(runStatus.busy ? Date.now() : null)
  }, [runStatus.busy])
  useEffect(() => {
    // 会话标题从列表组件读（读不到退 code 前缀——状态条不许猜标题）
    setActiveConvLabel(conversationListRef?.current?.getConvLabelByKey?.(activeConv) || '')
  }, [activeConv, messages.length])

  /**
   * 深度美化（属主 2026-11-19，与母本 console 同步）·头像对：
   * - 右侧=个人头像：有 avatarUrl 用真图；没有用**姓名首字+青碧渐变**——兜底也要像设计过的。
   * - 左侧=AI：方角渐变徽标（蓝紫）；u2u 对方用圆形同款渐变。
   */
  const myAvatar = () => (
    currentUser?.avatarUrl ? (
      <Avatar size={30} src={getDocHttpUrl(currentUser.avatarUrl)}/>
    ) : (
      <Avatar size={30} style={{background: 'linear-gradient(135deg, #38b2a3, #1e8f83)', fontWeight: 600, fontSize: 13, flexShrink: 0}}>
        {(currentUser?.realName || currentUser?.nickName || '我').trim().charAt(0)}
      </Avatar>
    )
  )
  const aiAvatar = () => (
    <Avatar shape="square" size={30} style={{borderRadius: 9, background: 'linear-gradient(135deg, #5b8cff, #7a5cff)', flexShrink: 0}}>
      <RobotOutlined style={{fontSize: 15}}/>
    </Avatar>
  )

  const memoRole: BubbleListProps['role'] = useMemo(
    () => ({
      ai: (data) => {
        let answerReasoning = data.extraInfo?.answerReasoning
        const streamState = data.extraInfo?.streamState
        /**
         * Agent UI 刀 A（刀五移植）：消息字段投影为结构化 parts（判据单源 messageParts，现算零存储）。
         * partsActive 时——正文/计划/工具/来源/说明行由 parts 渲染承担，
         * ProcessPanel 转 compact（来源不双显）、EmptyRoundNotice 静音文本行（归因判据不断供）、
         * 错误红线与 TaskCard 首帧说明去重。
         */
        const parts = projectMessageParts((data.extraInfo || {}) as any)
        const partsActive = parts.length > 0
        return {
          typing: true,
          /**
           * 现代化刀三→属主三轮复调（2026-11-19，与母本同步）：列宽上限全部撤除（利用率优先，
           * 行宽收放交给 1200px 外层容器）；flat 不再裸底——回答体在 CSS 层升格白卡分层。
           */
          variant: 'borderless' as const,
          header: (
            <Flex vertical gap={4}>
              {answerReasoning ? (
                <Think
                  defaultExpanded={!data.content}
                  styles={{content: {maxHeight: '300px', overflow: 'auto'}}}
                  title={data.content ? '思考续想' : '思考中'}
                >
                  <XMarkdown content={answerReasoning}/>
                </Think>
              ) : null}
              <ProcessPanel
                process={data.extraInfo?.process}
                toolCalls={data.extraInfo?.toolCalls}
                sources={data.extraInfo?.sources}
                fromCache={data.extraInfo?.fromCache}
                segments={data.extraInfo?.segments}
                streaming={streamState === 'streaming'}
                compact={partsActive}
                /**
                 * 取回全文的入口。这里闭包 messageCode 与鉴权头，面板因此既不需要知道 token
                 * 从哪来，也不会出现第二份取 token 的写法（`buildAuthHeaders` 全页只有一份）。
                 * 拿不到 messageCode 就不给函数 ⇒ 按钮不出现：界面不承诺没有入口的动作。
                 */
                toolResultLoader={(call: any) =>
                  call?.id && data.extraInfo?.messageCode
                    ? makeToolResultLoader({
                        // @ts-ignore LLM_API_BASE 是构建期注入的全局
                        url: `${LLM_API_BASE}/core/message/tool-result`,
                        messageCode: data.extraInfo.messageCode,
                        headers: buildAuthHeaders(),
                      })
                    : undefined
                }
              />
              {/*
                M8 刀二（刀五移植）：扇出受理气泡挂 live 任务卡（轮询 detail/取消/综合正文替换）。
                queued 不挂卡——排队的真结果会随排水落回**本会话**档案，刷新即见，卡片只会重复。
              */}
              {data.extraInfo?.taskKind === 'accepted' && data.extraInfo?.taskRootCode ? (
                <TaskCard
                  rootCode={data.extraInfo.taskRootCode}
                  note={partsActive ? undefined : data.extraInfo?.taskNote}
                  loadDetail={researchTaskDetail}
                  cancelTask={researchTaskCancel}
                  answerClarify={researchTaskClarifyAnswer}
                  loadSynthesis={loadSynthesisBody}
                  subscribeEvents={researchTaskEventsSubscribe}
                  onSettled={(rc: string) => {
                    // 终局=唯一清理凭据（卡片已把结局说出口，跟进账目可以销账）
                    const convNow = activeConvRef.current || ''
                    writePendingTasks(convNow, removePendingTask(readPendingTasks(convNow), rc))
                  }}
                  renderBody={(t) => <CollapsibleText text={t} renderText={mdText}/>}
                />
              ) : null}
              {/*
                空正文的说明按实测分三类给（判据在 segments.ts，用例在 segments.test.ts）：
                被服务重启打断 / 有过程可回放 / 首 token 前就取消。
                原先这里对任何 abort 行都写"内容不完整"——对第 3 类是假的（它根本没产出过内容），
                对第 2 类则是把最有价值的信息（当时做了什么）漏掉了。
              */}
              <EmptyRoundNotice
                content={asText(data.content)}
                segments={data.extraInfo?.segments}
                error={data.extraInfo?.errorText}
                process={data.extraInfo?.process}
                streamState={streamState}
                resumeNote={data.extraInfo?.resumeNote}
                taskNote={data.extraInfo?.taskNote}
                suppressNotes={partsActive}
              />
              {streamState === 'error' && !partsActive ? <Typography.Text type='danger'>{data.extraInfo?.errorText || '请求失败，请稍后再试'}</Typography.Text> : null}
            </Flex>
          ),
          contentRender: partsActive
            ? () => <MessageParts parts={parts} renderText={mdText} onOpenArtifact={openArtifactWorkspace}/>
            : contentRender,
          loadingRender: () => (
            <Space>
              <Spin size='small'/>
              {'正在生成内容，敬请等待。。。'}
            </Space>
          ),
          avatar: aiAvatar,
        }
      },
      user: (data) => ({
        typing: false,
        header: '对方',
        contentRender,
        avatar: () => (
          <Avatar size={30} style={{background: 'linear-gradient(135deg, #5b8cff, #7a5cff)', flexShrink: 0}}>
            <UserOutlined style={{fontSize: 15}}/>
          </Avatar>
        ),
      }),
      /**
       * 自己的消息（属主复调 2026-11-19）：去名牌；个人头像（无图=姓名首字渐变）；
       * 靠右浅主题底、右下角收小做"尾巴"。
       */
      my: (data) => ({
        placement: 'end',
        typing: false,
        variant: 'filled' as const,
        styles: {
          content: {
            borderRadius: '14px 14px 4px 14px',
            background: token.colorPrimaryBg,
            color: token.colorText,
            lineHeight: 1.7,
          },
        },
        contentRender,
        avatar: myAvatar,
      }),
      notice: {
        variant: 'filled',
        styles: {
          root: {padding: 0},
          content: {
            display: 'flex', justifyContent: 'center', alignItems: 'center',
            /** 白卡样式（.ant-bubble-start .ant-bubble-content）会波及系统行/分隔行——这里归零 */
            background: 'transparent', border: 'none', boxShadow: 'none', padding: 0,
          },
        },
      },
      system: {
        styles: {
          root: {padding: 0},
          content: {display: 'flex', justifyContent: 'center', background: 'transparent', border: 'none', boxShadow: 'none', padding: 0},
        },
      },
      divider: {
        styles: {
          root: {padding: 0},
          content: {background: 'transparent', border: 'none', boxShadow: 'none', padding: 0},
        },
      },
    }),
    [currentUser?.avatarUrl, currentUser?.realName, currentUser?.nickName, token.colorPrimaryBg, token.colorText],
  )

  const senderHeader = (
    <Sender.Header
      title='附件'
      open={attachmentsOpen}
      onOpenChange={setAttachmentsOpen}
      styles={{
        content: {
          padding: 0,
        },
      }}
    >
      <Attachments
        accept='.pdf,.doc,.docx,.xls,.xlsx,.html,.htm,.md,.txt,.jpg,.jpeg,.png,.gif,.bmp,.webp,.mp3,.wav,.ogg,.aac,.mp4,.avi,.mov,.wmv'
        beforeUpload={(file) => validateFile(file) || Upload.LIST_IGNORE}
        // @ts-ignore
        action={DOC_API_BASE + '/file/upload/simple'}
        headers={{'param-accessToken': getAccessToken()}}
        items={attachmentItems}
        onChange={handleAttachmentsChange}
        placeholder={(type) =>
          type === 'drop'
            ? {
              title: '拖拽文件到此处',
            }
            : {
              icon: <CloudUploadOutlined/>,
              title: '上传文件',
              description: '点击或拖拽文件到此处上传',
            }
        }
        getDropContainer={() => senderRef.current?.nativeElement}
      />
    </Sender.Header>
  )

  return (
    <XProvider locale={{...zhCN_X, ...zhCN}}>
      <Flex className={styles.container}>
        <ConversationList
          ref={conversationListRef}
          activeKey={activeConv}
          onConversationSelect={handleConversationSelect}
          onNewConversation={handleNewConversation}
        />

        <div className={styles.main}>
          <RunStatusBar
            status={runStatus}
            busySince={runBusySince}
            conversationLabel={activeConvLabel}
            conversationCode={activeConv}
            onStop={runStatus.canStop ? () => { isRequesting && abort() } : undefined}
          />
          <div className={styles.messageList}>
            <Bubble.List
              ref={listRef}
              items={items}
              autoScroll
              className={styles.messageContainer}
              role={memoRole}
            />
          </div>
          <div className={styles.inputArea}>
            <Sender
              ref={senderRef}
              loading={isRequesting}
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleSend}
              onCancel={async () => {
                isRequesting && abort()
              }}
              placeholder='请输入您的问题...'
              header={senderHeader}
              prefix={
                <Space size={8}>
                  <Badge dot={attachmentItems.length > 0 && !attachmentsOpen}>
                    <Button
                      onClick={() => setAttachmentsOpen(!attachmentsOpen)}
                      icon={<LinkOutlined/>}
                    />
                  </Badge>
                  <Tooltip title="任务模式：把问题拆解为子任务并行执行、后台完成（需服务端开启编排；未开启时自动按普通对话）">
                    <Space size={4}>
                      <Switch size="small" checked={taskMode} onChange={setTaskMode}/>
                      <span style={{fontSize: 12, color: '#888'}}>任务</span>
                    </Space>
                  </Tooltip>
                </Space>
              }
              allowSpeech={
                speechSupported && !speechNetworkError
                  ? {
                    recording,
                    onRecordingChange: async (nextRecording) => {
                      if (nextRecording) {
                        try {
                          const SpeechRecognition =
                            (window as any).SpeechRecognition ||
                            (window as any).webkitSpeechRecognition
                          if (!SpeechRecognition) {
                            message.error('当前浏览器不支持语音识别功能')
                            return
                          }
                          const recognition = new SpeechRecognition()
                          recognition.lang = 'zh-CN'
                          recognition.continuous = true
                          recognition.interimResults = true

                          let finalTranscript = ''

                          recognition.onresult = (event: any) => {
                            let interimTranscript = ''
                            for (let i = event.resultIndex; i < event.results.length; i++) {
                              const transcript = event.results[i][0].transcript
                              if (event.results[i].isFinal) {
                                finalTranscript += transcript
                              } else {
                                interimTranscript += transcript
                              }
                            }
                            //console.log(finalTranscript, interimTranscript)
                            setInputValue(finalTranscript + interimTranscript)
                          }

                          recognition.onerror = (event: any) => {
                            console.error('语音识别错误:', event.error)
                            if (event.error === 'no-speech') {
                              message.warning('未检测到语音')
                            } else if (event.error === 'not-allowed') {
                              message.error('麦克风权限被拒绝')
                            } else if (event.error === 'network') {
                              message.error('网络连接失败，请检查网络后重试')
                              setSpeechNetworkError(true)
                            } else {
                              message.error('语音识别出错')
                            }
                            setRecording(false)
                          }

                          recognition.onend = () => {
                            //console.log(finalTranscript, 'end')
                            setRecording(false)
                          }

                          recognition.start()
                          mediaRecorderRef.current = recognition as any
                          setRecording(true)
                        } catch (error) {
                          message.error('无法访问麦克风，请检查权限')
                        }
                      } else {
                        if (mediaRecorderRef.current) {
                          mediaRecorderRef.current.stop()
                          setRecording(false)
                        }
                      }
                    },
                  }
                  : false
              }
              className={styles.messageContainer}
            />
          </div>
        </div>
      </Flex>
      {/* 刀 B 工作区（刀五移植）：入口=消息内产物卡"打开"（带定位）；Drawer 内自拉会话清单 */}
      <ArtifactWorkspace
        open={artifactWs.open}
        focusCode={artifactWs.focusCode}
        conversationCode={activeConv}
        onClose={() => setArtifactWs({open: false, focusCode: null})}
        renderText={mdText}
        loadList={listConversationArtifacts}
        loadPage={readArtifactPage}
      />
    </XProvider>
  )
}

export default Index
