// @ts-ignore
import type {RequestConfig} from 'umi'
import {errorMessage} from '@/utils/msg'
import {getAccessToken, getUserCache, toLogin} from '@/utils/authority'
import {Modal} from 'antd'
import {ResponseStructure} from '@/services/request'

const codeMessage: any = {
  200: '服务器成功返回请求的数据。',
  201: '新建或修改数据成功。',
  202: '一个请求已经进入后台排队（异步任务）。',
  204: '删除数据成功。',
  400: '发出的请求有错误，服务器没有进行新建或修改数据的操作。',
  401: '用户没有权限（令牌、用户名、密码错误）。',
  403: '用户得到授权，但是访问是被禁止的。',
  404: '发出的请求针对的是不存在的记录，服务器没有进行操作。',
  406: '请求的格式不可得。',
  410: '请求的资源被永久删除，且不会再得到的。',
  422: '当创建一个对象时，发生一个验证错误。',
  500: '服务器发生错误，请检查服务器。',
  502: '网关错误。',
  503: '服务不可用，服务器暂时过载或维护。',
  504: '网关超时。',
}

let isTokenTimeoutModal = false

/**
 * @name 错误处理
 * pro 自带的错误处理， 可以在这里做自己的改动
 * @doc https://umijs.org/docs/max/request#配置
 */
export const errorConfig: RequestConfig = {
  // 统一的请求设定
  timeout: 30000,

  // 错误处理
  errorConfig: {
    // 错误抛出
    errorThrower: (res: ResponseStructure) => {
      const {code, msg} = res
      /*console.log(res, code);*/
      if (code !== 0) {
        const error: any = new Error(msg)
        error.name = 'ResError'
        error.info = {code, msg}
        throw error // 抛出自制的错误
      }
    },
    // 错误接收及处理
    errorHandler: (error: any, opts: any) => {
      if (opts?.skipErrorHandler) throw error
      /*console.log(error, opts);*/
      // 我们的 errorThrower 抛出的错误。
      if (error.name === 'ResError') {
        errorMessage(error.info?.msg || '请求出错，请稍后再试。')
      } else if (error.response && error.response.status) {
        // Axios 的错误
        // 请求成功发出且服务器也响应了状态码，但状态代码超出了 2xx 的范围
        const errorText = error.response.data?.msg || codeMessage[error.response.status] || error.response.statusText

        errorMessage(errorText)
      } else if (error.request) {
        // 请求已经成功发起，但没有收到响应
        // \`error.request\` 在浏览器中是 XMLHttpRequest 的实例，
        // 而在node.js中是 http.ClientRequest 的实例
        errorMessage('服务器没有响应，请稍后重试。')
      } else {
        // 发送请求时出了点问题
        errorMessage('发起请求出错，请稍后重试。')
      }
    },

  },

  // 请求拦截器
  requestInterceptors: [
    (config: any) => {
      // 拦截请求配置，进行个性化处理。
      let headers = config.headers || {}
      headers['param-accessToken'] = getAccessToken()
      if (process.env.NODE_ENV === 'development') {
        let userStr: string = getUserCache(false)
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        userStr && (headers['user-info'] = userStr)
      }
      return {
        ...config,
        headers
      }
    }
  ],

  // 响应拦截器
  responseInterceptors: [
    (response: any) => {
      // 拦截响应数据，进行个性化处理
      if ([4001, 4002].includes(response?.data?.code) && !isTokenTimeoutModal) {
        isTokenTimeoutModal = true
        Modal.warning({
          title: '会话超时',
          content: '登录超时，请重新登录。',
          okText: '重新登录',
          onOk: () => {
            isTokenTimeoutModal = false
            toLogin()
          },
        })
      }
      return response
    }
  ]
}
