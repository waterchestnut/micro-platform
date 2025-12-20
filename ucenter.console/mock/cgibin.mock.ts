// @ts-ignore
import { Request, Response } from 'express';

export default {
  'POST /cgi-bin/oauth/code/token': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'POST /cgi-bin/oauth/pwd/client-token': (req: Request, res: Response) => {
    res.status(200).send({});
  },
  'POST /cgi-bin/oauth/pwd/client-token/refresh': (req: Request, res: Response) => {
    res.status(200).send({});
  },
};
