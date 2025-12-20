// @ts-ignore
/* eslint-disable */
import { ResponseStructure, ragRequest as request } from '@/services/request';

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
