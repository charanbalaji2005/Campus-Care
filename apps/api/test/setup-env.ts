// Test-only configuration. Real deployments must provide their own secrets.
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET ??= 'test-session-secret-0123456789-abcdefghijklmnop';
process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
process.env.ANONYMITY_KEY ??= 'test-anonymity-key-0123456789-abcdefghijklmnop';
process.env.WEB_ORIGIN ??= 'http://localhost:3000';
process.env.STORAGE_DIR ??= '.test-storage';
process.env.DEV_MAIL_DIR ??= '.test-mail';
process.env.RUN_WORKER = 'false';
