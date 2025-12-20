// @ts-ignore
import { Request, Response } from 'express';

export default {
  'POST /core/search/msg/all': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'POST /core/search/msg/agg': (req: Request, res: Response) => {
    res.status(200).send({});
  },
};
