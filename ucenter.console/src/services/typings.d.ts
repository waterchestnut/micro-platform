// @ts-ignore
/* eslint-disable */

declare namespace API {
  enum Sorter {
    asc = 1,
    desc = -1
  }

  type ListOptions = {
    total?: number;
    withFormat?: number;
    sort?: {
      [key: string]: Sorter;
    };
  };
}
