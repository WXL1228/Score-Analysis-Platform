/* eslint-disable perfectionist/sort-imports */

// core
import { pinia } from "@/pinia"
import { router } from "@/router"
import App from "@/App.vue"
// css
import "normalize.css"
import "element-plus/dist/index.css"
import "@/pages/gradebook/styles.scss"
import "virtual:uno.css"

// 创建应用实例
const app = createApp(App)

// 安装 pinia 和 router
app.use(pinia).use(router)

// router 准备就绪后挂载应用
router.isReady().then(() => {
  app.mount("#app")
})
