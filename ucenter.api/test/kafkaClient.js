/**
 * @fileOverview
 * @author xianyang 2024/5/3
 * @module
 */

import '../init.js'
const {tools, logger, config} = ucenter

import {sendMessage} from '../daos/kafka/client.js'

sendMessage([{topic: config.kafka.topics.statistic.topic, value: JSON.stringify({info:'test'})}])