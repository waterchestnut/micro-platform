// @ts-ignore
import { Request, Response } from 'express';

export default {
  'GET /public-bin/agreement/user': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'GET /public-bin/agreement/privacy': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'GET /public-bin/mobile-range/check': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'GET /public-bin/region/all': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'GET /public-bin/region/tree': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'GET /public-bin/user-role/group/all': (req: Request, res: Response) => {
    res.status(200).send({});
  },
};
