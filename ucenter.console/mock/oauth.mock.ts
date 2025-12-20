// @ts-ignore
import { Request, Response } from 'express';

export default {
  'GET /oauth/authorize': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'GET /oauth/logout': (req: Request, res: Response) => {
    res.status(200).send({});
  },
};
