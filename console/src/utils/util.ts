import * as _uuid from "uuid";

export const base64Encode = (str: string) => {
  if (!str) {
    return str;
  }
  return Buffer.from(str).toString('base64');
};

export const base64Decode = (str: string) => {
  if (!str) {
    return str;
  }
  return Buffer.from(str, 'base64').toString('utf-8');
};

export const isNull = (obj: any) => {
  if (obj === null || obj === "" || obj === undefined || obj === 'undefined') {
    return true;
  } else {
    return false;
  }
};

/**
 * @description uuid-timestamp
 * @returns {*}
 */
export const uuid = () => {
  return _uuid.v1().replace(/-/g, '');
};

/**
 * @description uuid-random
 * @returns {string}
 */
export const uuidV4 = () => {
  return _uuid.v4().replace(/-/g, '');
};

export const waitTime = (time = 100) => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(true);
    }, time);
  });
};
