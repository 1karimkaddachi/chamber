import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const rootEnvPath = path.resolve(moduleDir, '../../../.env');

if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
} else {
  dotenv.config();
}

const num = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const bool = (value, fallback = false) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const isProduction = process.env.NODE_ENV === 'production';

const config = {
  env: process.env.NODE_ENV || 'development',
  isProduction,
  port: num(process.env.API_PORT, 3100),
  host: process.env.API_HOST || '0.0.0.0',
  webOrigin: process.env.WEB_ORIGIN || 'http://localhost:5173',
  serveWeb: bool(process.env.SERVE_WEB, isProduction),
  trustProxy: bool(process.env.TRUST_PROXY, false),
  logLevel: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  databaseUrl: process.env.DATABASE_URL || '',
  session: {
    secret: process.env.SESSION_SECRET || '',
    cookieSecure: bool(process.env.SESSION_COOKIE_SECURE, isProduction),
    maxAgeDays: num(process.env.SESSION_MAX_AGE_DAYS, 7),
    name: 'chamber.sid',
  },
  discord: {
    token: process.env.DISCORD_TOKEN || '',
    clientId: process.env.DISCORD_CLIENT_ID || '',
    clientSecret: process.env.DISCORD_CLIENT_SECRET || '',
    redirectUri: process.env.DISCORD_REDIRECT_URI || `http://localhost:${num(process.env.API_PORT, 3100)}/api/auth/callback`,
  },
  devAuth: bool(process.env.DEV_AUTH, false) && !isProduction,
  devUser: {
    id: process.env.DEV_AUTH_USER_ID || '100000000000000001',
    username: process.env.DEV_AUTH_USERNAME || 'Dev Operator',
    guildId: process.env.DEV_AUTH_GUILD_ID || '',
  },
  ai: {
    enabled: bool(process.env.AI_ENABLED, false),
    baseUrl: process.env.AI_BASE_URL || '',
    apiKey: process.env.AI_API_KEY || '',
    model: process.env.AI_MODEL || '',
  },
  // Anchored at the repository root so `npm run dev` (which runs from the
  // workspace directory) and the production entrypoint share one uploads folder.
  storageDir: path.resolve(moduleDir, '../../..', process.env.STORAGE_DIR || 'storage'),
  version: '1.0.0',
};

export function validateConfig() {
  const problems = [];
  if (!config.databaseUrl) problems.push('DATABASE_URL is required');
  if (!config.session.secret || config.session.secret.length < 32) {
    problems.push('SESSION_SECRET must be at least 32 characters');
  }
  if (config.isProduction && !config.discord.token) {
    problems.push('DISCORD_TOKEN is required in production');
  }
  if (config.isProduction && !config.discord.clientId) {
    problems.push('DISCORD_CLIENT_ID is required in production');
  }
  if (config.isProduction && !config.discord.clientSecret) {
    problems.push('DISCORD_CLIENT_SECRET is required in production');
  }
  if (config.isProduction && config.devAuth) {
    problems.push('DEV_AUTH cannot be enabled in production');
  }
  if (problems.length > 0) {
    const error = new Error(`Invalid configuration:\n- ${problems.join('\n- ')}`);
    error.code = 'CONFIG_INVALID';
    throw error;
  }
}

export const botConfigured = Boolean(config.discord.token && config.discord.clientId);
export const aiConfigured = Boolean(config.ai.enabled && config.ai.baseUrl && config.ai.model);

export default config;
