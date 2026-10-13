import type { Router } from "vue-router"

export function registerNavigationGuard(router: Router) {
  router.afterEach((to) => {
    document.title = `${to.meta.title || "成绩总览"} · 成绩分析平台`
  })
}
