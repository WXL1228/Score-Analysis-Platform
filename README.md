# Score Analysis Platform

A frontend student gradebook built with Vue 3, TypeScript, Vite, Pinia and Element Plus. Student management, Excel/CSV imports, rankings, trends and PDF reports run in the browser. No login or backend is required.

See [中文说明](./README.zh-CN.md) and [使用说明](./使用说明.md) for setup, deployment and grading rules.

```sh
pnpm i
pnpm dev
pnpm exec vitest run
pnpm build
pnpm preview
```

Deploy the contents of `dist`. Data is stored in localStorage under `gradebook-workspaces-v1`; use JSON backups to move data between browsers or devices.

Based on [V3 Admin Vite](https://github.com/un-pany/v3-admin-vite). See [LICENSE](./LICENSE).
