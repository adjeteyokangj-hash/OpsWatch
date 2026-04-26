import { randomUUID } from "crypto";
import { REQUEST_ID_HEADER } from "../config/constants";

export const requestId = (req: any, res: any, next: () => void) => {
  const id = req.header(REQUEST_ID_HEADER) || randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  next();
};
