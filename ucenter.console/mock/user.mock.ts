// @ts-ignore
import { Request, Response } from 'express';

export default {
  'POST /core/user/ipmi/updateRole': (req: Request, res: Response) => {
    res.status(200).send({ code: 86, msg: '平造效式最此大不转月例众细变。' });
  },
  'GET /core/user/cur': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'POST /core/user/cur/profile': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'POST /core/user/cur/mobile': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'POST /core/user/cur/email': (req: Request, res: Response) => {
    res.status(200).send({});
  },
};
