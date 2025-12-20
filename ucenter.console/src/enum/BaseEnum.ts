export function Label(label ?: string) {
  return (target: any, key: string) => {
    if (!target.enumList) {
      target.enumList = [];
    }
    const value = target[key];
    target.enumList.push({value, label: label || ''});
  }
}

export function MXEnum(target: any) {
  target.enumList = target.enumList || []
  target.valueEnum = null;
  target.labelEnum = null;

  target.toLabel = function (value: any) {
    return this.toValueEnum()[value];
  }

  target.toLabels = function () {
    return this.enumList.map((item: any) => item.label);
  }

  target.toValue = function (label: string) {
    return this.toLabelEnum()[label];
  }

  target.toValues = function () {
    return this.enumList.map((item: any) => item.value);
  }

  target.toOptions = function () {
    return this.enumList;
  }

  target.toValueEnum = function () {
    if (!this.valueEnum) {
      const t: any = {};
      this.enumList.forEach((item: any) => {
        t[item.value] = item.label;
      })
      this.valueEnum = t;
    }
    return this.valueEnum;
  }

  target.toLabelEnum = function () {
    if (!this.labelEnum) {
      const t: any = {};
      this.enumList.forEach((item: any) => {
        t[item.label] = item.value;
      })
      this.labelEnum = t;
    }
    return this.labelEnum;
  }
}

export default abstract class BaseEnum {

  static toLabel: (value: any) => string;

  static toValue: (label: string) => any;

  static toValues: () => any[];

  static toOptions: () => { value: any, label: string } [];

  static toValueEnum: () => any;

  static toLabelEnum: () => any;
}
