/**
 * @fileOverview 自定义验证规则
 * @author xianyang 2024/6/31
 * @module
 */

export const mobilePattern = /^1[3|4|5|6|7|8|9][0-9]\d{8}$/;

export const emailPattern = /^([a-zA-Z0-9_.-])+@(([a-zA-Z0-9-])+\.)+([a-zA-Z]{2,6})$/;

export const idCardSimplePattern = /(^\d{15}$)|(^\d{17}([0-9]|X)$)/;

export const passportNumberPattern = /^1[45][0-9]{7}$|(^[P|p|S|s]\d{7}$)|(^[S|s|G|g|E|e]\d{8}$)|(^[Gg|Tt|Ss|Ll|Qq|Dd|Aa|Ff]\d{8}$)|(^[H|h|M|m]\d{8,10}$)/;

export const socialCreditCodePattern = /[0-9A-HJ-NPQRTUWXY]{2}\d{6}[0-9A-HJ-NPQRTUWXY]{10}/

export const checkPasswordComplexity = (password: string) => {
  const userPwdRuleConfig = {
    /** 最小长度 */
    minLength: 8,
    /** 最大长度 */
    maxLength: 32,
    /** 最低复杂度级别 */
    minRequireLevel: 3,
    /** 需要验证密码包含的正则匹配(每匹配成功其中一条复杂度级别+1) */
    needRegex: {
      /** 数字正则 */
      numRegex: String.raw`[0-9]`,
      /** 小写正则 */
      lcaseRegex: String.raw`[a-z]`,
      /** 大写正则 */
      ucaseRegex: String.raw`[A-Z]`,
      /** 特殊符号正则 */
      specialRegex: String.raw`[^A-Za-z0-9\s]`,
    },
    /** 强制要求密码包含的规则，示例：requiredRegex: {numRegex:'数字',lcaseRegex: '小写字母'} */
    requiredRegex: {},
    /** 无效字符正则 */
    invalidRegex: String.raw`[\u4e00-\u9fa5\s]`,
  };
  let regx: any = {
    lengthRegex: /^.{8,32}$/,
    numRegex: /[0-9]/,
    lcaseRegex: /[a-z]/,
    ucaseRegex: /[A-Z]/,
    specialRegex: /[^A-Za-z0-9\s]/,
    invalidRegex: /[\u4e00-\u9fa5\s]/gi,
  };
  regx.lengthRegex = new RegExp(
    '^.{' + userPwdRuleConfig.minLength + ',' + userPwdRuleConfig.maxLength + '}$',
  );
  regx.invalidRegex = new RegExp(userPwdRuleConfig.invalidRegex, 'ig');
  let needRegex:any = userPwdRuleConfig.needRegex;
  for (let key in needRegex) {
    if ({}.hasOwnProperty.call(needRegex, key)) {
      regx[key] = new RegExp(needRegex[key]);
    }
  }
  let res: any = {};
  let level = 0;
  for (let key in regx) {
    if ({}.hasOwnProperty.call(regx, key)) {
      res[key] = regx[key].test(password);
      if (key !== 'lengthRegex' && key !== 'invalidRegex' && res[key]) {
        level += 1;
      }
    }
  }
  res.requiredIsValid = true;
  if (Object.keys(userPwdRuleConfig.requiredRegex).length > 0) {
    for (let key in userPwdRuleConfig.requiredRegex) {
      if (!res[key]) {
        res.requiredIsValid = false;
        break;
      }
    }
  }
  res.level = level >= userPwdRuleConfig.minRequireLevel;
  return res;
};
