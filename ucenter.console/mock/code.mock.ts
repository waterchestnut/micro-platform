// @ts-ignore
import { Request, Response } from 'express';

export default {
  'GET /core/captcha/': (req: Request, res: Response) => {
    res.status(200).send({});
  },
};
