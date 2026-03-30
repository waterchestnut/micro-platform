import BaseEnum, {Label, MXEnum} from './BaseEnum';

@MXEnum
export default class extends BaseEnum {
  @Label('中共党员')
  static partyMember = 1;
  @Label('中共预备党员')
  static probationaryMember = 2;
  @Label('共青团员')
  static youthLeagueMember = 3;
  @Label('民革党员')
  static minGeMember = 4;
  @Label('民盟盟员')
  static minMengMember = 5;
  @Label('民建会员')
  static minJianMember = 6;
  @Label('民进会员')
  static minJinMember = 7;
  @Label('农工党党员')
  static nonggongMember = 8;
  @Label('致公党党员')
  static zhiGongMember = 9;
  @Label('九三学社社员')
  static jiuSanMember = 10;
  @Label('台盟盟员')
  static taiMengMember = 11;
  @Label('无党派人士')
  static independent = 12;
  @Label('群众')
  static masses = 13;
}
