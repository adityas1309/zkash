function required(name: string, value?: string): string {
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function validateEnvironment(env: NodeJS.ProcessEnv) {
  required('SESSION_SECRET', env.SESSION_SECRET);

  const mongoUri = env.MONGODB_URI ?? env.MONGO_URI;
  required('MONGODB_URI or MONGO_URI', mongoUri);

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    console.warn(
      '[env] Google OAuth credentials missing; auth endpoints will not function until configured.',
    );
  }

  if (!env.RPC_URL) {
    console.warn('[env] RPC_URL missing; using default testnet Soroban RPC.');
  }
}
