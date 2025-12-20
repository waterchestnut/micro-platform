// @ts-ignore
import { Request, Response } from 'express';

export default {
  'POST /core/chat/stream': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'POST /core/conversation/list': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'POST /core/conversation/stat-channel-group': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'POST /core/message/list': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'POST /core/message/feedback': (req: Request, res: Response) => {
    res.status(200).send({});
  },
};
