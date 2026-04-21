// @ts-ignore
import { Request, Response } from 'express';

export default {
  'GET /core/home/client/list': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'POST /core/home/client/add': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'POST /core/home/client/remove': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'POST /core/home/client/batch/save': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'GET /core/home/widget/list': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'POST /core/home/widget/add': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'POST /core/home/widget/remove': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'POST /core/home/widget/batch/save': (req: Request, res: Response) => {
    res.status(200).send({});
  },
};
