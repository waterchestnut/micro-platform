/**
 * @fileOverview 正则表达式对象重写扩展
 * @author xianyang 2024/5/15
 * @module
 */

class Exp extends RegExp {
    constructor(pattern, flags, escape = false) {
        if (escape && Object.prototype.toString.call(pattern) === '[object String]') {
            pattern = pattern.replace('(', '\\(').replace(')', '\\)')
        }
        super(pattern, flags)
    }
}

global.RegExpExt = Exp