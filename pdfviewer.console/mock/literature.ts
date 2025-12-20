// @ts-ignore
import { Request, Response } from 'express';

export default {
  'POST /core/literature/check': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'POST /core/literature/local-file': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'POST /core/literature/remove': (req: Request, res: Response) => {
    res.status(200).send({});
  },
};
