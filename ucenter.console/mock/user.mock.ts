// @ts-ignore
import { Request, Response } from 'express';

export default {
  'POST /core/user/ipmi/updateRole': (req: Request, res: Response) => {
    res.status(200).send({ code: 72, msg: '科斗分东月支热质厂快张和群江少断。' });
  },
  'GET /core/user/cur': (req: Request, res: Response) => {
    res.status(200).send({});
  },
};
