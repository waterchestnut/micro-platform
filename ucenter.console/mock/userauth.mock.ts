// @ts-ignore
import { Request, Response } from 'express';

export default {
  'GET /core/user/auth/rsa-public-key': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'POST /core/user/auth/login': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'POST /core/user/auth/phone/verify': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'POST /core/user/auth/phone/login': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'POST /core/user/auth/email/verify': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'POST /core/user/auth/email/login': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'POST /core/user/auth/token/refresh': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'POST /core/user/auth/sms-code': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'POST /core/user/auth/register/phone/verify': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'POST /core/user/auth/register/phone': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'POST /core/user/auth/register/email/verify': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'POST /core/user/auth/register/email': (req: Request, res: Response) => {
    res.status(200).send({});
  },
};
