import type { VueWrapper } from "@vue/test-utils"
import type { GradebookArchive, Workspace } from "@/pages/gradebook/types"
import { CacheKey } from "@@/constants/cache-key"
import { flushPromises, mount } from "@vue/test-utils"
import { ElDialog, ElMessage } from "element-plus/es"
import { createPinia, setActivePinia } from "pinia"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createMemoryHistory, createRouter } from "vue-router"
import StudentDialog from "@/pages/gradebook/components/StudentDialog.vue"
import { createWorkspace } from "@/pages/gradebook/demo"
import Students from "@/pages/gradebook/Students.vue"
import { useGradebookStore } from "@/pinia/stores/gradebook"

let wrapper: VueWrapper | undefined
let target: HTMLDivElement

function fixture(withExam = true): Workspace {
  const data = createWorkspace("评价测试档案")
  data.subjects = [{ id: "math", name: "数学", max: 100, pass: 60, excellent: 85 }]
  data.classes = [{ id: "class-a", name: "一班" }, { id: "class-b", name: "二班" }]
  data.students = [
    { id: "student-a", number: "001", name: "学生甲", gender: "男", classId: "class-a", focus: false, note: "原有教师备注\n继续观察课堂表现" },
    { id: "student-b", number: "002", name: "学生乙", gender: "女", classId: "class-a", focus: true, note: "学生乙原有评价" }
  ]
  data.selectedClassId = "class-a"
  if (withExam) {
    data.exams = [
      { id: "exam-a", name: "第一次考试", date: "2026-10-01", subjects: data.subjects.map(subject => ({ ...subject })) },
      { id: "exam-b", name: "第二次考试", date: "2026-10-15", subjects: data.subjects.map(subject => ({ ...subject })) }
    ]
    data.records = [
      { examId: "exam-a", studentId: "student-a", scores: { math: 80 } },
      { examId: "exam-a", studentId: "student-b", scores: { math: 70 } },
      { examId: "exam-b", studentId: "student-a", scores: { math: 85 } },
      { examId: "exam-b", studentId: "student-b", scores: { math: 90 } }
    ]
    data.selectedExamId = "exam-a"
  }
  return data
}

function setup(data = fixture()) {
  localStorage.setItem(CacheKey.GRADEBOOK_DATA, JSON.stringify({ version: 1, activeWorkspaceId: data.id, workspaces: [data] }))
  const pinia = createPinia()
  setActivePinia(pinia)
  return { pinia, store: useGradebookStore() }
}

async function openStudents(withExam = true) {
  const options = setup(fixture(withExam))
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/students", component: { template: "<div />" } }] })
  await router.push("/students")
  await router.isReady()
  wrapper = mount(Students, { attachTo: target, global: { plugins: [options.pinia, router], stubs: { StudentDialog: true, ScoreDialog: true, teleport: true, transition: true } } })
  await flushPromises()
  return { ...options, view: wrapper }
}

async function evaluate(view: VueWrapper, number: string, name: string) {
  await view.get(`[aria-label="评价学生 ${number} ${name}"]`).trigger("click")
  await flushPromises()
}

describe("学生档案教师评价", () => {
  beforeEach(() => {
    localStorage.clear()
    target = document.createElement("div")
    document.body.appendChild(target)
    vi.spyOn(ElMessage, "success").mockImplementation(() => ({ close: () => {} }))
    vi.spyOn(ElMessage, "error").mockImplementation(() => ({ close: () => {} }))
  })
  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    target.remove()
    vi.restoreAllMocks()
  })

  it("保存只更新实际学生的评价，保留最新资料、其他学生及成绩，切换考试也不改变评价归属且重开缓存可恢复", async () => {
    const { view, store } = await openStudents()
    const records = JSON.stringify(store.workspace.records)
    const otherStudent = JSON.stringify(store.workspace.students[1])
    await evaluate(view, "001", "学生甲")
    const textarea = view.get("textarea[aria-label=\"教师评价内容\"]")
    expect((textarea.element as HTMLTextAreaElement).value).toBe("原有教师备注\n继续观察课堂表现")
    expect(textarea.attributes("maxlength")).toBe("300")
    const note = "课堂表达更主动，继续坚持整理错题。\n下周重点练习计算检查。"
    await textarea.setValue(note)
    const current = { ...store.workspace.students[0], number: "A001", name: "更新后的学生甲", gender: "女", focus: true }
    store.upsertStudent(current)
    store.workspace.selectedExamId = "exam-b"
    const save = vi.spyOn(store, "upsertStudent")
    await view.get("[aria-label=\"保存教师评价\"]").trigger("click")
    await flushPromises()
    expect(save).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledWith({ ...current, note })
    expect(Object.keys(save.mock.calls[0][0]).sort()).toEqual(["classId", "focus", "gender", "id", "name", "note", "number"])
    expect(store.workspace.students[0]).toEqual({ ...current, note })
    expect(JSON.stringify(store.workspace.students[1])).toBe(otherStudent)
    expect(JSON.stringify(store.workspace.records)).toBe(records)
    const cached = JSON.parse(localStorage.getItem(CacheKey.GRADEBOOK_DATA)!) as GradebookArchive
    expect(cached.workspaces[0].students[0]).toEqual({ ...current, note })
    view.unmount()
    wrapper = undefined
    store.$dispose()
    setActivePinia(createPinia())
    const reopened = useGradebookStore()
    expect(reopened.workspace.students[0]).toEqual({ ...current, note })
    reopened.$dispose()
  })

  it("无考试也能评价；取消和清空后取消不落库，评价与清除均只影响所选学生", async () => {
    const { view, store } = await openStudents(false)
    const originalA = store.workspace.students[0].note
    const before = localStorage.getItem(CacheKey.GRADEBOOK_DATA)
    await evaluate(view, "001", "学生甲")
    await view.get("textarea[aria-label=\"教师评价内容\"]").setValue("评".repeat(301))
    await view.get("[aria-label=\"保存教师评价\"]").trigger("click")
    expect(ElMessage.error).toHaveBeenLastCalledWith("教师评价最多 300 字")
    expect(localStorage.getItem(CacheKey.GRADEBOOK_DATA)).toBe(before)
    await view.get("textarea[aria-label=\"教师评价内容\"]").setValue("暂未保存")
    await view.get("[aria-label=\"取消教师评价\"]").trigger("click")
    expect(localStorage.getItem(CacheKey.GRADEBOOK_DATA)).toBe(before)
    await evaluate(view, "002", "学生乙")
    expect((view.get("textarea[aria-label=\"教师评价内容\"]").element as HTMLTextAreaElement).value).toBe("学生乙原有评价")
    await view.get("textarea[aria-label=\"教师评价内容\"]").setValue("学生乙本次教师评价")
    await view.get("[aria-label=\"保存教师评价\"]").trigger("click")
    await flushPromises()
    expect(store.workspace.students[0].note).toBe(originalA)
    expect(store.workspace.students[1].note).toBe("学生乙本次教师评价")
    await evaluate(view, "001", "学生甲")
    await view.get("[aria-label=\"清空教师评价\"]").trigger("click")
    expect((view.get("textarea[aria-label=\"教师评价内容\"]").element as HTMLTextAreaElement).value).toBe("")
    await view.get("[aria-label=\"取消教师评价\"]").trigger("click")
    expect(store.workspace.students[0].note).toBe(originalA)
    await evaluate(view, "001", "学生甲")
    await view.get("[aria-label=\"清空教师评价\"]").trigger("click")
    await view.get("[aria-label=\"保存教师评价\"]").trigger("click")
    await flushPromises()
    expect(store.workspace.students[0].note).toBe("")
    expect(store.workspace.students[1].note).toBe("学生乙本次教师评价")
  })

  it("档案切换后关闭评价窗口，过期保存事件不会写入另一档案", async () => {
    const { view, store } = await openStudents()
    const original = JSON.stringify(store.workspace)
    const originalId = store.workspace.id
    await evaluate(view, "001", "学生甲")
    await view.get("textarea[aria-label=\"教师评价内容\"]").setValue("不应跨档案保存")
    store.addWorkspace("另一档案", "")
    await flushPromises()
    expect(view.findComponent(ElDialog).props("modelValue")).toBe(false)
    await view.get("[aria-label=\"保存教师评价\"]").trigger("click")
    expect(store.workspace.students).toEqual([])
    expect(JSON.stringify(store.archive.workspaces.find(item => item.id === originalId))).toBe(original)
    expect(ElMessage.error).toHaveBeenLastCalledWith("档案已切换，请重新打开教师评价")
  })

  it("学生编辑窗口沿用原有评价内容和300字限制，取消不改变已有内容", async () => {
    const { pinia, store } = setup()
    const before = JSON.stringify(store.workspace.students)
    wrapper = mount(StudentDialog, { attachTo: target, props: { modelValue: false, student: store.workspace.students[0] }, global: { plugins: [pinia], stubs: { teleport: true, transition: true } } })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    expect(wrapper.text()).toContain("教师评价")
    const textarea = wrapper.get("textarea[aria-label=\"学生教师评价\"]")
    expect((textarea.element as HTMLTextAreaElement).value).toBe(store.workspace.students[0].note)
    expect(textarea.attributes("maxlength")).toBe("300")
    await textarea.setValue("未保存的教师评价")
    await wrapper.findAll("button").find(button => button.text() === "取消")!.trigger("click")
    expect(JSON.stringify(store.workspace.students)).toBe(before)
  })
})
