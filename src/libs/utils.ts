/**
 * Return env variable with boolean parsed
 * @param key
 * @param def
 */
export const pEnv = (key: string, def: any = undefined) => {
  const t = process.env[key];
  return t === 'true' ? true : t === 'false' ? false : t ?? def;
};

/**
 * Variable return true if dev mode
 */
export const isDev = pEnv('NODE_ENV') !== 'production';
