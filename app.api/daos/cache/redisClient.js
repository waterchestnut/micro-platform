/**
 * @fileOverview redis服务端缓存操作
 * @author xianyang
 * @module
 */

const redisConfig = app.config.redisConfig
const logger = app.logger
import Redis from 'ioredis'

const client = new Redis(redisConfig)

/**
 * @exports daos/cache/redisClient
 */
let redisClient = {

    /**
     * @description redis的客户端对象
     * @author xianyang
     */
    client: client,

    /**
     * 存储缓存信息数据
     * @author xianyang
     * @param {String} key 缓存键值
     * @param {Object|String} value 待缓存的数据，字符串或者对象
     * @param {Number} seconds 过期秒数
     * @returns {*} 存储是否成功
     */
    setValue: async function (key, value, seconds) {
        try {
            value = JSON.stringify(value)
            if (seconds) {
                seconds = parseInt(seconds, 10)
            } else seconds = 20 * 60
        } catch (err) {
            logger.error(err)
            throw err
        }
        let ret = await client.pipeline().set(key, value).get(key).expire(key, seconds).exec()
        return ret[0][1]
    },

    /**
     * 读取缓存信息数据
     * @author xianyang
     * @param {String} key 缓存键值
     * @returns {*} 缓存数据，为字符串或者对象
     */
    getValue: async function (key) {
        let data = (await client.pipeline().get(key).exec())[0][1]
        if (!data) {
            return null
        }
        try {
            return JSON.parse(data)
        } catch (error) {
            logger.error(error)
            throw error
        }
    },

    /**
     * 删除缓存信息数据
     * @author xianyang
     * @param {String} key 缓存键值
     * @returns {*} 删除的记录条数
     */
    delValue: async function (key) {
        if (!key || !key.length) {
            return 0
        }
        return (await client.pipeline().del(key).exec())[0][1]
    },

    /**
     * 更新缓存时间
     * @author xianyang
     * @param {String} key 缓存键值
     * @param {Number} seconds 过期秒数
     * @returns {*} 更新是否成功
     */
    updateExpire: async function (key, seconds) {
        return (await client.pipeline().expire(key, seconds).exec())[0][1]
    },

    /**
     * 读取满足指定表达式的键
     * @author xianyang
     * @param {String} _key 键表达式
     * @returns {*} 键列表
     */
    getKeys: async function (_key) {
        return (await client.pipeline().keys(_key).exec())[0][1]
    },

    /**
     * 键值增加指定的数值
     * @author xianyang
     * @param {String} key Redis键
     * @param {Number} [seconds] 新的过期时间
     * @param {Number} increment 增加的值
     * @returns {Promise<Number>} 增加后的值
     */
    addIncr: async function (key, seconds, increment = 1) {
        let ret = (await client.pipeline().incrby(key, increment).exec())[0][1]
        if (seconds) {
            await client.pipeline().expire(key, seconds).exec()
        }
        return ret
    }
}

export default redisClient
