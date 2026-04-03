// @ts-ignore
/* eslint-disable */
import { ResponseStructure, llmRequest as request } from '@/services/request';

/** AI生成课表 AI生成课表 返回值: Default Response POST /LLM/coursePlanning/generate */
export async function postLlmCoursePlanningGenerate(
  body: {
    /** 课程描述 */
    Course_Description: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: { coursePlanning?: { subject?: string; content?: string }[] };
  }>('/LLM/coursePlanning/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}
