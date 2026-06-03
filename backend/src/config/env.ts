import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  OPS_SHARED_SECRET: z.string().min(1),
  PAYMENT_WEBHOOK_SECRET: z.string().min(1),
  API_KEY_PEPPER: z.string().min(1),
});

export type AppEnv = z.infer<typeof envSchema>;

export const env = envSchema.parse(process.env);
