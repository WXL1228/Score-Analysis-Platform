# 成绩分析平台

基于 Vue 3、TypeScript、Vite、Pinia 和 Element Plus 的前端学生成绩管理系统。打开直接进入首页，数据保存在当前浏览器，无需登录或后端服务。

## 开发与验证

```sh
pnpm i
pnpm dev
pnpm exec vitest run
pnpm build
pnpm preview
```

开发服务默认端口为 3333；生产构建输出到 `dist`，部署时上传其内容。详细操作和统计规则见 [使用说明](./使用说明.md)。

## 源码结构

- `src/pages/gradebook`：成绩页面、弹窗、导入导出、统计与报告。
- `src/pinia/stores/gradebook.ts`：档案、班级、学生、考试和成绩状态。
- `src/common/utils/local-storage.ts`：浏览器持久化。
- `src/router`：静态页面路由。
- `tests/gradebook`：业务测试。

## 数据留存

正常关闭浏览器后数据继续保留。缓存键为 `gradebook-workspaces-v1`；清除网站数据或更换设备、浏览器、网址时，请通过 JSON 备份迁移。

## 来源与许可

前端基础来自 [V3 Admin Vite](https://github.com/un-pany/v3-admin-vite)，许可见 [LICENSE](./LICENSE)。
