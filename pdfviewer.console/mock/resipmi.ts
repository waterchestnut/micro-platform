// @ts-ignore
import { Request, Response } from 'express';

export default {
  'POST /core/res-info/ipmi/list': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'GET /core/res-info/ipmi/detail': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'POST /core/res-info/ipmi/update': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'POST /core/res-info/ipmi/delete': (req: Request, res: Response) => {
    res.status(200).send({});
  },
};
