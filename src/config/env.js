/**
 * Environment configuration and validation
 */

import { logger } from '../utils/logger.js';

// Required environment variables
const REQUIRED_VARS = [
  'NUTRITIONIX_API_KEY',
  'NUTRITIONIX_API_ID',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'OAUTH_CLIENT_SECRET'
];

// Optional with defaults
const OPTIONAL_VARS = {
  PORT: '3000',
  NODE_ENV: 'development',
  LOG_LEVEL: 'info',
  BASE_URL: null // Will be computed if not set
};

function validateEnv() {
  const missing = [];

  for (const varName of REQUIRED_VARS) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }

  if (missing.length > 0) {
    logger.error('Missing required environment variables:', { missing });
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  // Set defaults for optional vars
  for (const [key, defaultValue] of Object.entries(OPTIONAL_VARS)) {
    if (!process.env[key] && defaultValue) {
      process.env[key] = defaultValue;
    }
  }

  // Compute BASE_URL if not set
  if (!process.env.BASE_URL) {
    const port = process.env.PORT || '3000';
    process.env.BASE_URL = process.env.NODE_ENV === 'production'
      ? `https://macro-mcp.railway.app` // Update this after Railway deployment
      : `http://localhost:${port}`;
  }

  logger.info('Environment validation successful');
}

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  baseUrl: process.env.BASE_URL,
  logLevel: process.env.LOG_LEVEL || 'info',

  nutritionix: {
    apiKey: process.env.NUTRITIONIX_API_KEY,
    apiId: process.env.NUTRITIONIX_API_ID
  },

  supabase: {
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY
  },

  oauth: {
    clientSecret: process.env.OAUTH_CLIENT_SECRET,
    codeExpirySeconds: 600, // 10 minutes
    tokenExpirySeconds: 3600 // 1 hour
  },

  validate: validateEnv
};
