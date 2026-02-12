/**
 * @fileOverview Code Reviewer Skill 执行脚本
 * @description 实现代码审查相关的自动化指令
 * @module
 */

/**
 * @description 分析代码复杂度
 * @param {Object} params
 * @param {string} params.code - 代码内容
 * @param {string} params.language - 编程语言
 * @returns {Object}
 */
export async function analyzeComplexity(params) {
    const { code, language = 'javascript' } = params
    
    // 简单的复杂度分析
    const lines = code.split('\n')
    const complexity = {
        totalLines: lines.length,
        nonEmptyLines: lines.filter(l => l.trim()).length,
        functionCount: (code.match(/function|=>|\bdef\b/g) || []).length,
        ifCount: (code.match(/\bif\b/g) || []).length,
        loopCount: (code.match(/\b(for|while)\b/g) || []).length,
        nestedDepth: calculateNestedDepth(code),
        language: language
    }
    
    // 评估复杂度等级
    let level = 'low'
    if (complexity.nestedDepth > 3 || complexity.ifCount > 10) {
        level = 'high'
    } else if (complexity.nestedDepth > 2 || complexity.ifCount > 5) {
        level = 'medium'
    }
    
    return {
        success: true,
        command: 'analyzeComplexity',
        metrics: complexity,
        level: level,
        suggestions: generateComplexitySuggestions(complexity, level)
    }
}

/**
 * @description 计算嵌套深度
 * @param {string} code
 * @returns {number}
 */
function calculateNestedDepth(code) {
    const lines = code.split('\n')
    let maxDepth = 0
    let currentDepth = 0
    
    for (const line of lines) {
        const openBrackets = (line.match(/\{|\[|\(/g) || []).length
        const closeBrackets = (line.match(/\}|\]|\)/g) || []).length
        currentDepth += openBrackets - closeBrackets
        maxDepth = Math.max(maxDepth, currentDepth)
    }
    
    return maxDepth
}

/**
 * @description 生成复杂度改进建议
 * @param {Object} complexity
 * @param {string} level
 * @returns {string[]}
 */
function generateComplexitySuggestions(complexity, level) {
    const suggestions = []
    
    if (level === 'high') {
        suggestions.push('代码复杂度过高，建议拆分为更小的函数')
        suggestions.push('考虑使用卫语句减少嵌套层级')
    }
    
    if (complexity.functionCount > 5) {
        suggestions.push('函数数量较多，建议按职责分离到不同模块')
    }
    
    if (complexity.ifCount > 5) {
        suggestions.push('条件判断较多，考虑使用策略模式或多态替代')
    }
    
    return suggestions
}

/**
 * @description 安全检查
 * @param {Object} params
 * @param {string} params.code - 代码内容
 * @param {string} params.language - 编程语言
 * @returns {Object}
 */
export async function checkSecurity(params) {
    const { code, language = 'javascript' } = params
    
    const issues = []
    const codeLower = code.toLowerCase()
    
    // SQL 注入检查
    if (codeLower.includes('select') && codeLower.includes('from') && 
        (code.includes('$') || code.includes('+') || code.includes('${'))) {
        issues.push({
            severity: 'high',
            type: 'SQL Injection',
            message: '可能存在 SQL 注入风险，建议使用参数化查询',
            pattern: '动态 SQL 拼接'
        })
    }
    
    // XSS 检查
    if (codeLower.includes('innerhtml') || codeLower.includes('outerhtml')) {
        issues.push({
            severity: 'medium',
            type: 'XSS',
            message: '使用 innerHTML/outerHTML 可能导致 XSS 攻击',
            pattern: 'innerHTML/outerHTML'
        })
    }
    
    // 敏感信息检查
    const sensitivePatterns = [/password\s*[=:]/i, /secret\s*[=:]/i, /token\s*[=:]/i, /apikey\s*[=:]/i]
    for (const pattern of sensitivePatterns) {
        if (pattern.test(code)) {
            issues.push({
                severity: 'high',
                type: 'Sensitive Data',
                message: '代码中可能包含敏感信息硬编码',
                pattern: pattern.toString()
            })
            break
        }
    }
    
    // eval 检查
    if (codeLower.includes('eval(')) {
        issues.push({
            severity: 'high',
            type: 'Code Injection',
            message: '使用 eval() 存在代码注入风险',
            pattern: 'eval()'
        })
    }
    
    return {
        success: true,
        command: 'checkSecurity',
        issues: issues,
        score: Math.max(0, 100 - issues.length * 20),
        passed: issues.length === 0
    }
}

/**
 * @description 提供重构建议
 * @param {Object} params
 * @param {string} params.code - 代码内容
 * @param {string} params.issueType - 问题类型
 * @returns {Object}
 */
export async function suggestRefactoring(params) {
    const { code, issueType = 'general' } = params
    
    const suggestions = {
        longFunction: {
            pattern: '函数过长',
            solution: '将函数拆分为多个职责单一的小函数',
            example: '// 重构前\nfunction process() { /* 100行代码 */ }\n\n// 重构后\nfunction validate() { /* 验证逻辑 */ }\nfunction transform() { /* 转换逻辑 */ }\nfunction save() { /* 保存逻辑 */ }'
        },
        deepNesting: {
            pattern: '嵌套过深',
            solution: '使用卫语句提前返回，减少嵌套层级',
            example: '// 重构前\nif (a) {\n  if (b) {\n    if (c) { doSomething() }\n  }\n}\n\n// 重构后\nif (!a) return\nif (!b) return\nif (!c) return\ndoSomething()'
        },
        magicNumbers: {
            pattern: '魔法数字',
            solution: '将魔法数字提取为命名常量',
            example: '// 重构前\nif (status === 200) { /* ... */ }\n\n// 重构后\nconst HTTP_OK = 200\nif (status === HTTP_OK) { /* ... */ }'
        }
    }
    
    const suggestion = suggestions[issueType] || suggestions.general || {
        pattern: '代码优化',
        solution: '建议参考代码最佳实践进行优化',
        example: '// 请参考相关重构技巧'
    }
    
    return {
        success: true,
        command: 'suggestRefactoring',
        issueType: issueType,
        suggestion: suggestion,
        allPatterns: Object.keys(suggestions)
    }
}

/**
 * @description 执行 Skill 命令的入口函数
 * @param {string} commandName - 命令名称
 * @param {Object} parameters - 命令参数
 * @returns {Promise<Object>}
 */
export async function executeCommand(commandName, parameters = {}) {
    switch (commandName) {
        case 'analyzeComplexity':
            return await analyzeComplexity(parameters)
        case 'checkSecurity':
            return await checkSecurity(parameters)
        case 'suggestRefactoring':
            return await suggestRefactoring(parameters)
        default:
            throw new Error(`未知命令: ${commandName}`)
    }
}
