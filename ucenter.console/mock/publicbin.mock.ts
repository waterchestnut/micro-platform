// @ts-ignore
import { Request, Response } from 'express';

export default {
  'GET /public-bin/mobile-range/check': (req: Request, res: Response) => {
    res.status(200).send({});
  },
};
