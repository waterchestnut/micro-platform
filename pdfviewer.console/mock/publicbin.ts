// @ts-ignore
import { Request, Response } from 'express';

export default {
  'POST /public-bin/resource/recommend': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'GET /public-bin/resource/thesis/detail': (req: Request, res: Response) => {
    res.status(200).send({});
  },
};
