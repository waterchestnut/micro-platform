/**
 * @fileOverview 正则表达式对象重写扩展
 * @author xianyang 2024/5/15
 * @module
 */

/** 正则元字符全集，escape=true 时全部按字面量处理 */
const META_CHARS = /[.*+?^${}()|[\]\\]/g

class Exp extends RegExp {
    constructor(pattern, flags, escape = false) {
        if (escape && Object.prototype.toString.call(pattern) === '[object String]') {
            pattern = pattern.replace(META_CHARS, '\\$&')
        }
        super(pattern, flags)
    }
}

global.RegExpExt = Exp