import {ucenterRequest} from '@/services/request'

export async function getCarsiConfig() {
  return ucenterRequest('/public-bin/carsi/config', {method: 'GET'})
}