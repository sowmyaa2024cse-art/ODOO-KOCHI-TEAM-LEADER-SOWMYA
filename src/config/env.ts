import { z } from "zod";

const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z.string().url(),
    AUTH_TOKEN_SECRET: z.string().min(32),
    RESET_TOKEN_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/),
    WEB_BASE_URL: z.url().default("http://localhost:4173"),
    MARGIN_GUARD_MODE: z.enum(["warn", "block"]).default("warn"),
  })
  .superRefine((environment, context) => {
    if (
      environment.NODE_ENV === "production" &&
      environment.AUTH_TOKEN_SECRET.startsWith("replace-")
    ) {
      context.addIssue({
        code: "custom",
        path: ["AUTH_TOKEN_SECRET"],
        message: "Production requires a generated auth token secret.",
      });
    }

    if (
      environment.NODE_ENV === "production" &&
      /^0{64}$/.test(environment.RESET_TOKEN_ENCRYPTION_KEY)
    ) {
      context.addIssue({
        code: "custom",
        path: ["RESET_TOKEN_ENCRYPTION_KEY"],
        message: "Production requires a generated reset encryption key.",
      });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export function parseEnvironment(
  input: NodeJS.ProcessEnv = process.env,
): Environment {
  const result = environmentSchema.safeParse(input);

  if (!result.success) {
    const details = result.error.issues.map(
      (issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`,
    );
    throw new Error(`Invalid environment configuration: ${details.join("; ")}`);
  }

  return result.data;
}
