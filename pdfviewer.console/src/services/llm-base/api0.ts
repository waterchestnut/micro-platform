// @ts-ignore
/* eslint-disable */
import { ResponseStructure, llmRequest as request } from '@/services/request';

/** 此处后端没有提供注释 GET / */
export async function get(options?: { [key: string]: any }) {
  return request<any>('/', {
    method: 'GET',
    ...(options || {}),
  });
}

/** 此处后端没有提供注释 GET /example/ */
export async function getExample(options?: { [key: string]: any }) {
  return request<any>('/example/', {
    method: 'GET',
    ...(options || {}),
  });
}

/** AI出题 调用AI出题 POST /LLM/exercise/set/question */
export async function postLlmExerciseSetQuestion(
  body: {
    questionType?: number;
    question?: string;
  },
  options?: { [key: string]: any },
) {
  return request<any>('/LLM/exercise/set/question', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** AI出题 调用AI发起course POST /LLM/learoadCourse/course */
export async function postLlmLearoadCourseCourse(
  body: {
    /** 课程名称 */
    courseName: string;
    /** 课程要求 */
    courseRequirement: string;
    /** 计划周次 */
    week?: number;
  },
  options?: { [key: string]: any },
) {
  return request<any>('/LLM/learoadCourse/course', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}
