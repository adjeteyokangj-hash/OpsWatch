import jwt from "jsonwebtoken";
import { env } from "../config/env";

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  organizationId?: string;
}

export const signJwt = (payload: JwtPayload): string => {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: "12h" });
};

export const verifyJwt = (token: string): JwtPayload => {
  const decoded = jwt.verify(token, env.jwtSecret);
  if (!decoded || typeof decoded === "string") {
    throw new Error("Invalid JWT payload");
  }
  return decoded as JwtPayload;
};
