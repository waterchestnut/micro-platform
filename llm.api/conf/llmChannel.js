/**
 * @fileOverview 大模型对话频道的设置
 * @author xianyang
 * @module
 */

export default {
    /** 通用聊天助手 */
    xxzx_common: {
        /** 系统提示词 */
        sysPrompt: `你是一个高校师生教、学助手，请根据用户提供的用户资料回答用户的问题。`,
        /** 增强检索提示词 */
        ragPrompt: `## 用户资料： \n
    {{segs}}`,
    },
    /** 文献助手 */
    pdfviewer_literature: {
        /** 系统提示词 */
        sysPrompt: `你是一个文献解读专家，请根据用户提供的文献材料回答用户的问题。`,
        /** 增强检索提示词 */
        ragPrompt: `## 文献材料： \n
    {{segs}}`,
    },
}