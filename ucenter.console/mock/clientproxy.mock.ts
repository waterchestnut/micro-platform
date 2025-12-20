// @ts-ignore
import { Request, Response } from 'express';

export default {
  'GET /client-proxy/oauth/callback': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'GET /client-proxy/oauth/sign-in': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'GET /client-proxy/oauth/sign-out': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'GET /client-proxy/oauth/authorize': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'GET /client-proxy/oauth/logout': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'GET /client-proxy/': (req: Request, res: Response) => {
    res.status(200).send({});
  },
};
