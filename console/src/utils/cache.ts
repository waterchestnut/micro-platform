export const setCache = (key:string, value:any) => {
  localStorage.setItem(key, value);
};

export const getCache = (key:string) => {
  return localStorage.getItem(key);
};

export const delCache = (key:string) => {
  return localStorage.removeItem(key);
};
