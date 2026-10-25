// Test-only configuration. Real deployments must provide their own secrets.
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET ??= 'test-session-secret-0123456789-abcdefghijklmnop';
process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
process.env.ANONYMITY_KEY ??= 'test-anonymity-key-0123456789-abcdefghijklmnop';
process.env.WEB_ORIGIN ??= 'http://localhost:3000';
process.env.STORAGE_DIR ??= '.test-storage';
process.env.DEV_MAIL_DIR ??= '.test-mail';
process.env.RUN_WORKER = 'false';
// Tests must never reach real people: force the console mail provider and no push credentials,
// whatever apps/api/.env contains (dotenv never overrides variables that are already set).
process.env.EMAIL_PROVIDER = 'console';
process.env.FCM_SERVICE_ACCOUNT_JSON = '';
process.env.MAIL_USER = '';
process.env.MAIL_APP_PASSWORD = '';
