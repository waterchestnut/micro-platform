// @ts-ignore
import { Request, Response } from 'express';

export default {
  'POST /cgi-bin/oauth/code/token': (req: Request, res: Response) => {
    res.status(200).send({});
  },
};
