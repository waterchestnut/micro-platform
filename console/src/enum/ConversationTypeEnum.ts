import BaseEnum, {Label, MXEnum} from './BaseEnum'

@MXEnum
export default class extends BaseEnum {
  @Label('大模型对话')
  static chat = 'chat'
  @Label('智能体任务')
  static agentTask = 'agentTask'
  @Label('单一用户对用户聊天')
  static u2u = 'u2u'
  @Label('多对多用户聊天')
  static m2m = 'm2m'
}
