// @ts-ignore
import { Request, Response } from 'express';

export default {
  'POST /core/res-my/list': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'GET /core/res-my/detail': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'POST /core/res-my/update': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'POST /core/res-my/delete': (req: Request, res: Response) => {
    res.status(200).send({});
  },
};
