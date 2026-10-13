// A separate room server for automated browser tests (pairs with `vite --mode qa --port 5174`).
process.env.PORT ||= '3101';
process.env.ALLOWED_ORIGINS ||= 'http://localhost:5174,http://127.0.0.1:5174';
await import('../../server/index.mjs');
