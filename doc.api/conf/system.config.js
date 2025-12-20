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
        /** 示例轮询时间配置 */
        demoPattern: '0 45 2 * * *', //每天的凌晨2点45分执行
    },
    /** 用户授权中心的配置 */
    ucenterConfig: {
        /** 基地址 */
        baseUrl: process.env['UCENTER_URI'],
        /** 内网基地址 */
        baseIntranetUrl: process.env['UCENTER_URI_INTRANET'],
        /** rpc服务的地址 */
        grpcHost: process.env['UCENTER_GRPC'],
        /** 最大传送数据：256M */
        maxMessageLength: 256 * 1024 * 1024,
    },
    /** 用户授权中心的配置 */
    minioConfig: {
        /** 默认的节点配置 */
        defaultMinioCode: process.env['MINIO_DEFAULT'],
        /** 保存文件的接口地址、bucket等 */
        endPoints: {
            minioBase: {
                endPoint: process.env['MINIO_BASE_ENDPOINT'],
                port: parseInt(process.env['MINIO_BASE_PORT']),
                useSSL: process.env['MINIO_BASE_SSL'] === 'true',
                accessKey: process.env['MINIO_BASE_ACCESS'],
                secretKey: process.env['MINIO_BASE_SECRET'],
                bucketName: process.env['MINIO_BASE_BUCKET'],
            }
        },
    },
    /** 资源转换服务的配置 */
    transformConfig: {
        /** 基地址 */
        baseUrl: process.env['TRANSFORM_URI'],
        /** 内网基地址 */
        baseIntranetUrl: process.env['TRANSFORM_URI_INTRANET'],
        /** rpc服务的地址 */
        grpcHost: process.env['TRANSFORM_GRPC'],
        /** 最大传送数据：256M */
        maxMessageLength: 256 * 1024 * 1024,
    },
}
