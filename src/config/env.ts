import 'dotenv/config';

export const env = {
  get PORT() {
    return Number(process.env.PORT ?? 3000);
  },
  get NODE_ENV() {
    return process.env.NODE_ENV ?? 'development';
  },
  get LOG_LEVEL() {
    return process.env.LOG_LEVEL ?? 'info';
  },
  get API_KEY() {
    return process.env.API_KEY ?? '';
  },
  get DATABASE_URL() {
    return process.env.DATABASE_URL ?? '';
  },
  get REDIS_URL() {
    return process.env.REDIS_URL ?? '';
  }
};
