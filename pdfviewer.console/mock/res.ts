// @ts-ignore
import { Request, Response } from 'express';

export default {
  'POST /core/res-info/add': (req: Request, res: Response) => {
    res.status(200).send({});
  },
};
