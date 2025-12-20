// @ts-ignore
/* eslint-disable */

import {ResponseStructure, statisticRequest} from '@/services/request'

/**
 * @description 索引库资源检索
 * @param {object} queryParams  查询条件(影响排序)
 * @param {object} filterParams 筛选条件(只过滤不影响排序)
 * @param {Array} sort 排序字段：[['insertTime','asc'],['updateTime','desc']]
 * @param {Number} pageIndex 页码
 * @param {Number} [pageSize=10] 每页数量
 * @param {object} exportParams 导出查询结构相关的参数
 * @returns {Promise<{total: number}|*>}
 */
async function queryMsgList(queryParams: any, filterParams: any, sort: any[], pageIndex = 1, pageSize = 10, exportParams = {}) {
  let paramList = assembleParams(queryParams, filterParams)
  let ret = await statisticRequest('/core/search/msg/all', {
    method: 'POST',
    data: {
      pageIndex,
      pageSize,
      sort,
      paramList,
      ...exportParams
    }
  })
  if (ret.code === 0) {
    if (typeof ret.data?.total == 'undefined') {
      return ret
    }
    return ret.data
  } else {
    return {total: 0, rows: []}
  }
}

/**
 * @description 索引库资源统计
 * @param {object} queryParams  查询条件(影响排序)
 * @param {object} filterParams 筛选条件(只过滤不影响排序)
 * @param {object} aggParams 聚合字段
 * @param {object} exportParams 导出查询结构相关的参数
 * @returns {Promise<{total: number}|*>}
 */
async function msgAgg(queryParams: any, filterParams: any, aggParams: any = {}, exportParams: any = {}) {
  let paramList = assembleParams(queryParams, filterParams)
  let ret = await statisticRequest('/core/search/msg/agg', {
    method: 'POST',
    data: {
      aggParams,
      paramList,
      filter: filterParams,
      ...exportParams
    }
  })
  if (ret.code === 0) {
    if (typeof ret.data?.total == 'undefined') {
      return ret
    }
    return ret.data
  } else {
    return {total: 0}
  }
}

function assembleParams(queryParams: any, filterParams: any) {
  let query: any[] = []
  const pushQuery = (item: any) => {
    if (query.length) {
      query.push('and')
    }
    query.push(item)
  }

  if (queryParams.commonMatch) {
    pushQuery({q: queryParams.commonMatch, key: 'commonMatch', method: 'match'})
  }
  if (queryParams.msgCode) {
    pushQuery({
      q: queryParams.msgCode,
      key: 'msgCode',
      method: 'term'
    })
  }
  if (queryParams.operateType) {
    pushQuery({
      q: queryParams.operateType,
      key: 'operateType',
      method: 'term'
    })
  }
  if (queryParams.userCode) {
    pushQuery({
      q: queryParams.userCode,
      key: 'userCode',
      method: 'term'
    })
  }
  if (queryParams.realName) {
    pushQuery({
      q: queryParams.realName,
      key: 'realName',
      method: 'term'
    })
  }
  if (queryParams.clientCode) {
    pushQuery({
      q: queryParams.clientCode,
      key: 'clientCode',
      method: 'term'
    })
  }
  if (queryParams.clientName) {
    pushQuery({
      q: queryParams.clientName,
      key: 'clientName',
      method: 'term'
    })
  }
  if (queryParams.sysCode) {
    pushQuery({
      q: queryParams.sysCode,
      key: 'sysCode',
      method: 'term'
    })
  }
  if (queryParams.sysName) {
    pushQuery({
      q: queryParams.sysName,
      key: 'sysName',
      method: 'term'
    })
  }
  if (Array.isArray(queryParams.browseTime)) {
    pushQuery({
      q: {gte: queryParams.browseTime[0], lte: queryParams.browseTime[1]},
      key: 'browseTime',
      method: 'range'
    })
  }

  if (!query.length) {
    pushQuery({q: ''})
  }

  return [{query, filter: filterParams || {}}]
}

export {
  queryMsgList,
  msgAgg,
  assembleParams as assembleMsgParams,
}
