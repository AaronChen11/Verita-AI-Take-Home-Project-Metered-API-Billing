import type { AuthenticatedCustomer, AuthenticatedOps } from "../auth/context.js";

declare global {
  namespace Express {
    interface Request {
      customer?: AuthenticatedCustomer;
      ops?: AuthenticatedOps;
    }
  }
}
