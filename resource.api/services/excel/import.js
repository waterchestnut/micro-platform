/**
 * @fileOverview 从Excel中读取数据
 * @author xianyang 2025/8/18
 * @module
 */

import ExcelJS from 'exceljs'

function formatMixValue(cellValue) {
    let result = cellValue
    if (typeof (cellValue) === 'object') {
        /*console.log(cellValue)*/
        if (cellValue?.richText && Array.isArray(cellValue?.richText)) {
            result = ''
            let arr = cellValue?.richText?.map(item => {
                return item.text
            })
            result += arr?.join('')
        } else if (cellValue?.text) {
            result = cellValue?.text
        } else if (cellValue?.result) {
            result = cellValue?.result
        } else {
            result = cellValue
        }
    }
    return result
}

async function getSheetData(sheet, options = {}) {
    let skipRow = options.skipRow || 1
    let columns = []
    let columnKeys = {}
    sheet.getRow(skipRow).values.forEach(cellValue => {
        let columnKey = formatMixValue(cellValue)
        columnKeys[columnKey] = columnKey
        columns.push({key: columnKey})
    })
    sheet.columns = columns
    /*console.log(columnKeys)*/

    let list = []
    sheet.eachRow((row, rowIndex) => {
        if (rowIndex <= skipRow) {
            return
        }
        let item = {}
        let fieldMap = options.fieldMap || columnKeys
        for (let fieldName in fieldMap) {
            let value = row.getCell(fieldName).value
            if (columnKeys[fieldName] && value) {
                if (typeof (value) === 'object') {
                    item[fieldMap[fieldName]] = options.notFormat ? value : formatMixValue(value)
                } else {
                    item[fieldMap[fieldName]] = (value.text || value) + ''
                }
            }
        }
        list.push(item)
    })
    return list
}

export async function getFirstSheetData(filePath, options) {
    let workbook = new ExcelJS.Workbook()
    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
        let data = (await fetch(encodeURI(filePath))).buffer()
        await workbook.xlsx.load(data)
    } else {
        await workbook.xlsx.readFile(filePath)
    }

    let sheet = workbook.worksheets[0]
    return getSheetData(sheet, options)
}