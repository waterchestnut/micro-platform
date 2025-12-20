/**
 * @fileOverview 导出数据到Excel相关的操作
 * @author xianyang
 * @module
 */

import ExcelJS from 'exceljs'

const dayjs = resource.module.dayjs
const tools = resource.tools

export async function exportDataToLocal(sheets, fileName) {
    const workbook = getWorkbook()
    appendData(workbook, sheets)
    await workbook.xlsx.writeFile(fileName)
    return 'done'
}

function getWorkbook() {
    const workbook = new ExcelJS.Workbook()
    workbook.creator = '微平台'
    workbook.lastModifiedBy = '微平台'
    workbook.created = new Date()
    workbook.modified = new Date()
    return workbook
}

function appendData(workbook, sheets) {
    for (let i = 0; i < sheets.length; i++) {
        const columns = sheets[i].columns
        const dataSource = sheets[i].dataSource
        const sheetName = sheets[i].sheetName || ('sheet' + (i + 1))
        const sheetTitle = sheets[i].sheetTitle

        const worksheet = workbook.addWorksheet(sheetName, {properties: {defaultRowHeight: 20, defaultColWidth: 20}})
        worksheet.views = [{}]
        /*列设置*/
        let cols = []
        columns.forEach((col, index) => {
            if (!col.title) {
                return
            }
            if (!col.key && !col.dataIndex) {
                return
            }
            let item = {
                header: col.title,
                key: getColKey(col),
                originalIndex: index,
                style: {alignment: {wrapText: true, vertical: 'middle', horizontal: 'center'}},
                width: 20
            }
            if (col.width) {
                item.width = parseInt(col.width) / 6.4
            }
            cols.push(item)
        })
        worksheet.columns = cols
        worksheet.getRow(1).eachCell(function (cell, colNumber) {
            cell.style = {alignment: {wrapText: true, vertical: 'middle', horizontal: 'center'}, font: {bold: true}}
        })
        if (sheetTitle) {
            worksheet.insertRow(1, [sheetTitle])
            worksheet.mergeCells(1, 1, 1, cols.length)
            worksheet.getCell(1, 1).style = {
                alignment: {wrapText: true, vertical: 'middle', horizontal: 'center'},
                font: {bold: true, size: 16}
            }
            worksheet.getRow(1).height = 40
        }

        /*添加数据*/
        dataSource.forEach((record, index) => {
            let row = cols.map(col => {
                return getCellData(record, columns[col.originalIndex], index)
            })
            /*console.log(row, worksheet.columns, columns)*/
            worksheet.addRow(row)
        })
        worksheet.eachRow((row, rowNumber) => {
            if (!sheetTitle || rowNumber > 1) {
                row.height = 30
            }
        })
    }
}

function getColKey(col) {
    return col.key || (tools.isArray(col.dataIndex) ? col.dataIndex.join('_') : col.dataIndex)
}

function getCellData(record, col, index) {
    try {
        let data = ''
        if (tools.isString(col.dataIndex)) {
            data = formatCellData(record[col.dataIndex], col)
        } else if (tools.isArray(col.dataIndex)) {
            if (col.dataIndex.length === 1) {
                data = formatCellData(record[col.dataIndex[0]], col)
            } else {
                const nextRecord = record[col.dataIndex[0]]
                let dataIndex = [...col.dataIndex]
                dataIndex.shift()
                if (tools.isArray(nextRecord)) {
                    data = nextRecord.map(item => getCellData(item, {...col, dataIndex})).join('\r\n')
                } else {
                    data = getCellData(nextRecord, {...col, dataIndex})
                }
            }
        }
        return data
    } catch (e) {
        return ''
    }
}

function formatCellData(value, col) {
    if (col.valueEnum) {
        if (tools.isArray(value)) {
            return value.map(_ => col.valueEnum[_]).filter(_ => _).join('；')
        }

        let data = col.valueEnum[value]
        if (tools.isUndefined(data)) {
            data = col.defaultValue || ''
        }
        return data
    }
    if (col.valueType && ['date', 'dateRange'].includes(col.valueType)) {
        return value ? dayjs(value).format('YYYY-MM-DD') : (col.defaultValue || '')
    }
    if (col.valueType && ['dateTime', 'dateTimeRange'].includes(col.valueType)) {
        return value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : (col.defaultValue || '')
    }
    if (tools.isArray(value)) {
        return value.join('；')
    }
    if (typeof value == 'undefined' && col.defaultValue) {
        return col.defaultValue
    }
    return tools.toStr(value)
}