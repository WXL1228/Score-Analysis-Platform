import type { RouteRecordRaw } from "vue-router"
import { createRouter } from "vue-router"
import { routerConfig } from "@/router/config"
import { registerNavigationGuard } from "@/router/guard"

export const constantRoutes: RouteRecordRaw[] = [
  {
    path: "/",
    component: () => import("@/pages/gradebook/GradebookLayout.vue"),
    redirect: "/dashboard",
    children: [
      { path: "dashboard", name: "GradebookOverview", component: () => import("@/pages/gradebook/Overview.vue"), meta: { title: "成绩总览" } },
      { path: "scores", name: "GradebookScores", component: () => import("@/pages/gradebook/Scores.vue"), meta: { title: "成绩录入" } },
      { path: "students", name: "GradebookStudents", component: () => import("@/pages/gradebook/Students.vue"), meta: { title: "学生管理" } },
      { path: "analysis", name: "GradebookAnalysis", component: () => import("@/pages/gradebook/Analysis.vue"), meta: { title: "学科分析" } },
      { path: "trends", name: "GradebookTrends", component: () => import("@/pages/gradebook/Trends.vue"), meta: { title: "趋势追踪" } },
      { path: "reports", name: "GradebookReports", component: () => import("@/pages/gradebook/Reports.vue"), meta: { title: "报告中心" } },
      { path: "settings", name: "GradebookSettings", component: () => import("@/pages/gradebook/Settings.vue"), meta: { title: "班级设置" } }
    ]
  },
  { path: "/:pathMatch(.*)*", redirect: "/dashboard" }
]

// 保留模板 Store 的导出兼容；应用只使用公开的静态业务路由。
export const dynamicRoutes: RouteRecordRaw[] = []
export const router = createRouter({ history: routerConfig.history, routes: constantRoutes })
export function resetRouter() {}
registerNavigationGuard(router)
