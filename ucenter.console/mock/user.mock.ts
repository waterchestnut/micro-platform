// @ts-ignore
import { Request, Response } from 'express';

export default {
  'POST /core/user/ipmi/updateRole': (req: Request, res: Response) => {
    res.status(200).send({ code: 77, msg: '往体型日如门派住特养保率给常。' });
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
