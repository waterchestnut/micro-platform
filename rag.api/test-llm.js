/**
 * @fileOverview 临时验证功能
 * @author xianyang
 * @module
 */

import './init.js'
import {generatePPT} from './services/core/llm.js'
import {getRagSegments} from './services/core/ragSegment.js'

const logger = rag.logger

console.log(await getRagSegments())