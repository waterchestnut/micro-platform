import type {XAgentCommand_v0_9} from '@ant-design/x-card'

export interface CardInfo {
  id: string
  title: string
}

export const CARD_LIST: CardInfo[] = [
  {id: 'card_research', title: '科研文献助手'},
  {id: 'card_subscribe', title: '文献订阅'},
  {id: 'card_group_read', title: '小组阅读'},
  {id: 'card_scholar', title: '学术讨论'},
  {id: 'card_crowd', title: '资源众筹'},
  {id: 'card_foleac', title: 'Classroom'},
  {id: 'card_call_course', title: '一人私塾'},
  {id: 'card_crowd_learn', title: '众学汇'},
  {id: 'card_mopit', title: '学业蓝图'},
  {id: 'card_graduate', title: '论文服务'},
  {id: 'card_affair', title: '基层教务'},
]

const mockCardData: Record<string, XAgentCommand_v0_9[]> = {
  card_research: [
    {
      version: 'v0.9',
      createSurface: {
        surfaceId: 'card_research',
        catalogId: 'local://home_card_catalog.json',
      },
    },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'card_research',
        components: [
          {
            id: 'text_1',
            component: 'CardText',
            content: 'SnS纳米薄膜和高温体玻璃热电性能研究',
            url: '/research/sns-nanofilm',
          },
          {
            id: 'highlight_1',
            component: 'CardHighlight',
            prefix: '新增',
            count: 5,
            suffix: '个文献 · 新增',
            count2: 5,
            suffix2: '个综述',
          },
          {
            id: 'root',
            component: 'CardContent',
            children: ['text_1', 'highlight_1'],
          },
        ],
      },
    },
  ],
  card_subscribe: [
    {
      version: 'v0.9',
      createSurface: {
        surfaceId: 'card_subscribe',
        catalogId: 'local://home_card_catalog.json',
      },
    },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'card_subscribe',
        components: [
          {
            id: 'text_1',
            component: 'CardText',
            content: '激光对瞬离子的阻碍研究',
            color: '#722ed1',
            url: '/subscribe/laser-research',
          },
          {
            id: 'highlight_1',
            component: 'CardHighlight',
            prefix: '新增',
            count: 5,
            suffix: '个文献',
          },
          {
            id: 'root',
            component: 'CardContent',
            children: ['text_1', 'highlight_1'],
          },
        ],
      },
    },
  ],
  card_group_read: [
    {
      version: 'v0.9',
      createSurface: {
        surfaceId: 'card_group_read',
        catalogId: 'local://home_card_catalog.json',
      },
    },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'card_group_read',
        components: [
          {
            id: 'text_1',
            component: 'CardText',
            content: '激光对瞬离子的阻碍研究',
            color: '#722ed1',
          },
          {
            id: 'highlight_1',
            component: 'CardHighlight',
            prefix: '新增',
            count: 5,
            suffix: '个文献 · 新增',
            count2: 5,
            suffix2: '个综述',
          },
          {
            id: 'root',
            component: 'CardContent',
            children: ['text_1', 'highlight_1'],
          },
        ],
      },
    },
  ],
  card_scholar: [
    {
      version: 'v0.9',
      createSurface: {
        surfaceId: 'card_scholar',
        catalogId: 'local://home_card_catalog.json',
      },
    },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'card_scholar',
        components: [
          {
            id: 'list_1',
            component: 'CardList',
            items: [
              {text: '【回复】激光对瞬离子的阻碍研究', url: '/scholar/reply'},
              '【签字】激光对瞬离子的阻碍研究',
            ],
          },
          {
            id: 'root',
            component: 'CardContent',
            children: ['list_1'],
          },
        ],
      },
    },
  ],
  card_crowd: [
    {
      version: 'v0.9',
      createSurface: {
        surfaceId: 'card_crowd',
        catalogId: 'local://home_card_catalog.json',
      },
    },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'card_crowd',
        components: [
          {
            id: 'list_1',
            component: 'CardList',
            items: [
              {status: 'success', text: '激光对瞬离子的阻碍研究'},
              {status: 'error', text: '激光对瞬离子的阻碍研究'},
              {status: 'default', text: '激光对瞬离子的阻碍研究'},
            ],
          },
          {
            id: 'root',
            component: 'CardContent',
            children: ['list_1'],
          },
        ],
      },
    },
  ],
  card_foleac: [
    {
      version: 'v0.9',
      createSurface: {
        surfaceId: 'card_foleac',
        catalogId: 'local://home_card_catalog.json',
      },
    },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'card_foleac',
        components: [
          {
            id: 'schedule_1',
            component: 'CardSchedule',
            items: [
              {
                time: '今天 2024-09-20 周五 8:50-10:50',
                course: '机械制图',
                location: '电子楼301',
                type: 'class',
                url: '/schedule/mechanical-drawing',
              },
            ],
          },
          {
            id: 'list_1',
            component: 'CardList',
            items: [
              '【作业】机械制图 作业20 人/未交 15 人',
              '【作业】机械制图 作业20 人/未交 15 人',
            ],
          },
          {
            id: 'root',
            component: 'CardContent',
            children: ['schedule_1', 'list_1'],
          },
        ],
      },
    },
  ],
  card_call_course: [
    {
      version: 'v0.9',
      createSurface: {
        surfaceId: 'card_call_course',
        catalogId: 'local://home_card_catalog.json',
      },
    },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'card_call_course',
        components: [
          {
            id: 'text_1',
            component: 'CardText',
            content: '【本周呼叫】激光对瞬离子的阻碍研究',
          },
          {
            id: 'root',
            component: 'CardContent',
            children: ['text_1'],
          },
        ],
      },
    },
  ],
  card_crowd_learn: [
    {
      version: 'v0.9',
      createSurface: {
        surfaceId: 'card_crowd_learn',
        catalogId: 'local://home_card_catalog.json',
      },
    },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'card_crowd_learn',
        components: [
          {
            id: 'schedule_1',
            component: 'CardSchedule',
            items: [
              {
                time: '今天 2024-09-20 周五 8:50-10:50',
                course: '机械制图',
                location: '电子楼301',
                type: 'share',
              },
            ],
          },
          {
            id: 'root',
            component: 'CardContent',
            children: ['schedule_1'],
          },
        ],
      },
    },
  ],
  card_mopit: [
    {
      version: 'v0.9',
      createSurface: {
        surfaceId: 'card_mopit',
        catalogId: 'local://home_card_catalog.json',
      },
    },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'card_mopit',
        components: [
          {
            id: 'highlight_1',
            component: 'CardHighlight',
            prefix: '【张三】重补',
            count: 1,
            suffix: '门，未交作业',
            count2: 3,
            suffix2: '次',
            url: '/mopit/zhangsan',
          },
          {
            id: 'root',
            component: 'CardContent',
            children: ['highlight_1'],
          },
        ],
      },
    },
  ],
  card_graduate: [
    {
      version: 'v0.9',
      createSurface: {
        surfaceId: 'card_graduate',
        catalogId: 'local://home_card_catalog.json',
      },
    },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'card_graduate',
        components: [
          {
            id: 'list_1',
            component: 'CardList',
            items: [
              {text: '【张三】开题答辩审查', url: '/graduate/zhangsan'},
              {text: '【李四】开题答辩审查', url: '/graduate/lisi'},
              {text: '【王五】开题答辩审查', url: '/graduate/wangwu'},
            ],
          },
          {
            id: 'root',
            component: 'CardContent',
            children: ['list_1'],
          },
        ],
      },
    },
  ],
  card_affair: [
    {
      version: 'v0.9',
      createSurface: {
        surfaceId: 'card_affair',
        catalogId: 'local://home_card_catalog.json',
      },
    },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'card_affair',
        components: [
          {
            id: 'text_1',
            component: 'CardText',
            content: '提交本学期行政事务工时',
          },
          {
            id: 'root',
            component: 'CardContent',
            children: ['text_1'],
          },
        ],
      },
    },
  ],
}

export async function fetchCardA2UICommands(cardId: string): Promise<XAgentCommand_v0_9[]> {
  await new Promise((resolve) => setTimeout(resolve, 300))

  return mockCardData[cardId] || []
}
