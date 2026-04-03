// @ts-ignore
import { Request, Response } from 'express';

export default {
  'POST /core/grpc-skill/ipmi/list': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'GET /core/grpc-skill/ipmi/detail': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'POST /core/grpc-skill/ipmi/update': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'POST /core/grpc-skill/ipmi/delete': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'POST /core/grpc-skill/ipmi/enable': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'POST /core/grpc-skill/ipmi/disable': (req: Request, res: Response) => {
    res.status(200).send({});
  },
};
