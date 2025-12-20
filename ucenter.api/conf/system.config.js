/**
 * @description 系统配置文件
 * @module conf/system.config
 */
import dotenv from 'dotenv'
// Read the .env file
dotenv.config()

export default {
    /** debug为true时，为调试模式 */
    debug: true,
    /** 部署环境需要修改，mongodb数据库配置 */
    mongodbConfig: {
        uri: process.env['MONGO_URI'],
        options: {
            dbName: process.env['MONGO_DB'],
            maxPoolSize: 100,
            minPoolSize: 2,
            socketTimeoutMS: 30000,
            serverSelectionTimeoutMS: 30000,
            autoIndex: true,
            user: process.env['MONGO_USER'],
            pass: process.env['MONGO_PASS'],
            authSource: 'admin'
        }
    },
    /** redis 配置，存储session等信息 */
    redisConfig: {
        host: process.env['REDIS_HOST'],
        port: parseInt(process.env['REDIS_PORT']),
        db: parseInt(process.env['REDIS_DB']),
        username: process.env['REDIS_USERNAME'],
        password: process.env['REDIS_PASSWORD']
    },
    /** 分布式锁的Redis配置 */
    redlockRedis: process.env['REDLOCK_URI'],
    /** 加密cookie的秘钥 */
    cookieSecret: process.env['COOKIE_SECRET'],
    /** 默认缓存数据过期时间，单位：分钟 */
    cacheExpiresTime: 60 * 24 * 7,
    /** accessToken过期时间，单位：分钟 */
    accessTokenExpiresTime: 60 * 24,
    /** 用户登录错误信息统计过期时间，单位：分钟 */
    userErrorNumberExpiresTime: 60 * 24,
    /** refreshToken过期时间，单位：分钟 */
    refreshTokenExpiresTime: 60 * 24 * 30,
    /** clientAccessToken过期时间，单位：分钟 */
    clientAccessTokenExpiresTime: 60 * 24,
    /** clientRefreshToken过期时间，单位：分钟 */
    clientRefreshTokenExpiresTime: 60 * 24 * 7,
    /** 外网访问的基地址 */
    baseUrl: process.env['MY_FRONTEND_URI'],
    /** 第三方应用相关配置 */
    client: {
        /** token接口访问次数限制（每日） */
        tokenLimit: 60
    },
    /** 统一认证的客户端代理的配置 */
    clientProxy: {
        /** 【部署需要修改】，OAuth state过期时间，单位：分钟 */
        stateExpiresTime: 60,
        /** 认证地址 */
        authUrl: '/oauth/authorize',
        /** 统一认证退出地址 */
        authLogoutUrl: '/oauth/logout',
        /** 回调的本地地址 */
        authBackUrl: '/client-proxy/oauth/callback',
        clients: {}
    },
    /** 域名跨域访问的白名单 */
    allowedOrigins: [/localhost(:\d*)?$/, /127\.0\.0\.1(:\d*)?$/, /jtxuexi\.com(:\d*)?$/],
    /** kafka相关的配置 */
    kafka: {
        /** 客户端ID */
        clientId: process.env['KAFKA_CLIENTID'],
        brokers: process.env['KAFKA_BROKERS'].split(','),
        sasl: {
            mechanism: process.env['KAFKA_SASL_MECHANISM'],
            username: process.env['KAFKA_SASL_USERNAME'],
            password: process.env['KAFKA_SASL_PASSWORD']
        },
        retry: {
            retries: 8
        },
        /** 消息组相关配置 */
        topics: {
            /** 统计信息 */
            statistic: {
                topic: process.env['KAFKA_STATISTIC_TOPIC'],
                groupId: process.env['KAFKA_STATISTIC_GROUPID']
            },
        }
    },
    /** 轮询相关配置 */
    cron: {
        /** 用户索引库更新的轮询时间配置 */
        userIndexUpdatePattern: '0 45 2 * * *', //每天的凌晨2点45分执行
    },
    /** 检索相关的配置 */
    searchConfig: {
        /** 用户信息 */
        user: {
            /** 索引库基地址 */
            baseUrl: process.env['SEARCH_USER_URI'],
            /** 索引库名称 */
            index: process.env['SEARCH_USER_INDEX'],
            /** 授权信息 */
            auth: {
                username: process.env['SEARCH_USER_AUTH_USERNAME'],
                password: process.env['SEARCH_USER_AUTH_PASSWORD']
            }
        },
    },
    /** 用户密码规则配置 */
    userPwdRuleConfig: {
        /** 最小长度 */
        minLength: 8,
        /** 最大长度 */
        maxLength: 32,
        /** 最低复杂度级别 */
        minRequireLevel: 3,
        /** 需要验证密码包含的正则匹配(每匹配成功其中一条复杂度级别+1) */
        needRegex: {
            /** 数字正则 */
            numRegex: String.raw`[0-9]`,
            /** 小写正则 */
            lcaseRegex: String.raw`[a-z]`,
            /** 大写正则 */
            ucaseRegex: String.raw`[A-Z]`,
            /** 特殊符号正则 */
            specialRegex: String.raw`[^A-Za-z0-9\s]`,
        },
        /** 强制要求密码包含的规则，示例：requiredRegex: {numRegex:'数字',lcaseRegex: '小写字母'} */
        requiredRegex: {},
        /** 无效字符正则 */
        invalidRegex: String.raw`[\u4e00-\u9fa5\s]`,
        /** 提示文字 */
        tipText: '提示：密码由8-32位（大写字母、小写字母、数字、符号）组成，至少包含其中三项'
    },
    /** 邮件发送相关的配置 */
    email: {
        /** smtp服务器 */
        host: process.env['EMAIL_HOST'],
        /** smtp端口号 */
        port: parseInt(process.env['EMAIL_PORT']),
        /** 是否ssl加密 */
        ssl: process.env['EMAIL_SSL'] === 'true',
        /** 发送验证码的邮件用户名 */
        codeNoticeUser: process.env['EMAIL_CODE_USER'],
        /** 发送验证码的邮件用户名密码 */
        codeNoticePwd: process.env['EMAIL_CODE_PWD'],
        /** 验证码内容格式，#code#-验证码 */
        codeNoticeDataFormat: process.env['EMAIL_CODE_FORMAT'],
        /** 【部署需要修改】，验证码缓存时间，单位：分钟*/
        codeCacheTime: parseInt(process.env['EMAIL_CODE_TIME']),
    },
    /** 用户组相关配置 */
    userGroup: {
        /** 普通用户组的标识 */
        general: 'general-user',
    },
    /** 短信接口相关的配置 */
    sms: {
        /* 验证码缓存时间，单位：分钟 */
        codeCacheTime: parseInt(process.env['SMS_CODE_TIME']),
        /* 阿里云KeyId */
        accessKeyId: process.env['SMS_ALIYUN_KEY'],
        /* 阿里云KeySecret */
        accessKeySecret: process.env['SMS_ALIYUN_SECRET'],
        /* 默认短信签名 */
        signName: process.env['SMS_ALIYUN_SIGN_NAME'],
        /* 短信验证码默认模板 */
        smsCodeTemplateCode: process.env['SMS_ALIYUN_CODE_TMPL']
    },
    /** 使用模式相关配置 */
    schema: {
        /** 默认的使用模式*/
        default: ''
    },
}
