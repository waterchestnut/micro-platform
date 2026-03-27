// @ts-ignore
import { Request, Response } from 'express';

export default {
  'POST /core/user/ipmi/updateRole': (req: Request, res: Response) => {
    res.status(200).send({ code: 80, msg: '老世加利热极问都关音系议管那当每。' });
  },
  'GET /core/user/cur': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'POST /core/user/profile': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'POST /core/user/mobile': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'POST /core/user/email': (req: Request, res: Response) => {
    res.status(200).send({});
  },
};
