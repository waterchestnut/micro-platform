import BaseEnum, {Label, MXEnum} from './BaseEnum';

@MXEnum
export default class extends BaseEnum {
  @Label('GET')
  static GET = 'GET';
  @Label('POST')
  static POST = 'POST';
  @Label('PUT')
  static PUT = 'PUT';
  @Label('DELETE')
  static DELETE = 'DELETE';
  @Label('PATCH')
  static PATCH = 'PATCH';
  @Label('HEAD')
  static HEAD = 'HEAD';
  @Label('OPTIONS')
  static OPTIONS = 'OPTIONS';
  @Label('CONNECT')
  static CONNECT = 'CONNECT';
  @Label('TRACE')
  static TRACE = 'TRACE';
}

