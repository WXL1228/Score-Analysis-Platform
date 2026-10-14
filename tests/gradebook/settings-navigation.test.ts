import { mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"
import { describe, expect, it, vi } from "vitest"
import { nextTick } from "vue"
import { createMemoryHistory, createRouter } from "vue-router"
import Settings from "@/pages/gradebook/Settings.vue"
import { useGradebookStore } from "@/pinia/stores/gradebook"

describe("考试记录成绩入口", () => {
  it("点击后选择该次考试、进入成绩录入并回到页首，不改动成绩", async () => {
    localStorage.clear()
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useGradebookStore()
    const records = JSON.stringify(store.workspace.records)
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/settings", component: { template: "<div />" } },
        { path: "/scores", component: { template: "<div />" } }
      ]
    })
    await router.push("/settings")
    await router.isReady()
    const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {})
    const wrapper = mount(Settings, { global: { plugins: [pinia, router], stubs: { ExamDialog: true, ClassImportDialog: true } } })
    try {
      await nextTick()
      await vi.waitFor(() => expect(wrapper.find("[aria-label=\"查看 开学摸底考试 成绩\"]").exists()).toBe(true))
      await wrapper.find("[aria-label=\"查看 开学摸底考试 成绩\"]").trigger("click")
      await vi.waitFor(() => {
        expect(router.currentRoute.value.path).toBe("/scores")
        expect(scroll).toHaveBeenCalledWith({ top: 0, left: 0 })
      })
      expect(store.workspace.selectedExamId).toBe("exam-1")
      expect(JSON.stringify(store.workspace.records)).toBe(records)
    } finally {
      wrapper.unmount()
      scroll.mockRestore()
      store.$dispose()
    }
  })
})
