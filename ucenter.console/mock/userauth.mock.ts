// @ts-ignore
import { Request, Response } from 'express';

export default {
  'GET /core/user/auth/rsa-public-key': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'POST /core/user/auth/login': (req: Request, res: Response) => {
    res.status(200).send({});
  },
};
