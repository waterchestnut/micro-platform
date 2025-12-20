// @ts-ignore
import { Request, Response } from 'express';

export default {
  'POST /core/search/resource/all': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'POST /core/search/resource/agg': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'POST /core/search/resource/merge': (req: Request, res: Response) => {
    res.status(200).send({});
  },
};
