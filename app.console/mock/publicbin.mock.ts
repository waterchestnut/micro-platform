// @ts-ignore
import { Request, Response } from 'express';

export default {
  'GET /public-bin/client/show/pc': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'GET /public-bin/client/show/mini': (req: Request, res: Response) => {
    res.status(200).send({});
  },
};
