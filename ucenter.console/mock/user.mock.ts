// @ts-ignore
import { Request, Response } from 'express';

export default {
  'POST /core/user/ipmi/updateRole': (req: Request, res: Response) => {
    res.status(200).send({ code: 60, msg: '并安合总家米较高现级资明当声用验。' });
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
