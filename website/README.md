# diyworld website

The public diyworld website lives in this folder as an independent Next.js application.

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Set `DATABASE_URL` to a Postgres connection string before submitting the application form.

## Deployment

Import the repository into Vercel and set the project root directory to `website`. Connect a Neon Postgres integration so Vercel injects `DATABASE_URL`, then deploy.
