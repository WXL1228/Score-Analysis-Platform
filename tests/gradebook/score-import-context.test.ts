import type { VueWrapper } from "@vue/test-utils"
import type { Workspace } from "@/pages/gradebook/types"
import { CacheKey } from "@@/constants/cache-key"
import { flushPromises, shallowMount } from "@vue/test-utils"
import { ElMessage, ElMessageBox } from "element-plus/es"
import { createPinia, setActivePinia } from "pinia"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { defineComponent, nextTick } from "vue"
import { readScoreFile } from "@/pages/gradebook/files"
import Scores from "@/pages/gradebook/Scores.vue"
import { useGradebookStore } from "@/pinia/stores/gradebook"

vi.mock("@/pages/gradebook/files", async importOriginal => ({
  ...await importOriginal<typeof import("@/pages/gradebook/files")>(),
  readScoreFile: vi.fn()
}))

const Button = defineComponent({
  props: { disabled: Boolean },
  emits: ["click"],
  template: "<button :disabled=\"disabled\" @click=\"$emit('click', $event)\"><slot /></button>"
})
const Dialog = defineComponent({
  props: { modelValue: Boolean },
  template: "<section v-if=\"modelValue\" data-testid=\"import-preview\"><slot /><slot name=\"footer\" /></section>"
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function workbook(score = 88) {
  return [{ name: "成绩", matrix: [["学号", "姓名", "数学"], ["001", "学生甲", score]] }]
}

function fixture(): Workspace {
  const math = { id: "math", name: "数学", max: 100, pass: 60, excellent: 85 }
  return {
    id: "teacher",
    name: "教师档案",
    teacher: "老师",
    demo: false,
    warningThreshold: 5,
    classes: [{ id: "class", name: "一班" }],
    subjects: [math],
    students: [{ id: "student", number: "001", name: "学生甲", classId: "class", focus: false, note: "" }],
    exams: [{ id: "exam", name: "月考", date: "2026-10-01", subjects: [math] }],
    records: [{ examId: "exam", studentId: "student", scores: { math: 65 } }],
    selectedClassId: "class",
    selectedExamId: "exam"
  }
}

async function upload(wrapper: VueWrapper) {
  const input = wrapper.get<HTMLInputElement>("input[type=\"file\"]")
  Object.defineProperty(input.element, "files", { configurable: true, value: [new File([""], "成绩.xlsx")] })
  await input.trigger("change")
  await flushPromises()
}

async function confirmImport(wrapper: VueWrapper) {
  const button = wrapper.get("[data-testid=\"import-preview\"]").findAll("button").find(item => item.text().startsWith("确认导入"))!
  expect(button.attributes("disabled")).toBeUndefined()
  await button.trigger("click")
}

function changeExam(store: ReturnType<typeof useGradebookStore>) {
  store.upsertExam({ ...store.exam!, subjects: [{ id: "math", name: "数学", max: 150, pass: 90, excellent: 130 }] })
}

describe("成绩导入预览配置过期保护", () => {
  let wrapper: VueWrapper | undefined
  let store: ReturnType<typeof useGradebookStore>

  beforeEach(() => {
    localStorage.clear()
    vi.mocked(readScoreFile).mockReset()
    const data = fixture()
    localStorage.setItem(CacheKey.GRADEBOOK_DATA, JSON.stringify({ version: 1, activeWorkspaceId: data.id, workspaces: [data] }))
    const pinia = createPinia()
    setActivePinia(pinia)
    store = useGradebookStore()
    vi.spyOn(ElMessage, "error").mockReturnValue({ close: vi.fn() })
    vi.spyOn(ElMessage, "success").mockReturnValue({ close: vi.fn() })
    wrapper = shallowMount(Scores, { global: { plugins: [pinia], stubs: { ElButton: Button, ElDialog: Dialog } } })
  })

  afterEach(() => {
    wrapper?.unmount()
    store.$dispose()
    vi.restoreAllMocks()
  })

  it("读取文件期间修改同一次考试科目配置后，忽略旧请求返回的预览", async () => {
    const reading = deferred<Awaited<ReturnType<typeof readScoreFile>>>()
    vi.mocked(readScoreFile).mockReturnValueOnce(reading.promise)
    const importing = vi.spyOn(store, "importScores")
    await upload(wrapper!)
    expect(readScoreFile).toHaveBeenCalledOnce()
    changeExam(store)
    await nextTick()
    const cache = localStorage.getItem(CacheKey.GRADEBOOK_DATA)
    reading.resolve(workbook())
    await flushPromises()
    expect(wrapper!.find("[data-testid=\"import-preview\"]").exists()).toBe(false)
    expect(importing).not.toHaveBeenCalled()
    expect(store.workspace.records[0].scores.math).toBe(65)
    expect(localStorage.getItem(CacheKey.GRADEBOOK_DATA)).toBe(cache)
  })

  it("确认导入等待期间修改同一考试配置后，拒绝旧预览且不再写入缓存或成绩", async () => {
    const confirming = deferred<Awaited<ReturnType<typeof ElMessageBox.confirm>>>()
    const confirmation = vi.spyOn(ElMessageBox, "confirm").mockReturnValueOnce(confirming.promise)
    vi.mocked(readScoreFile).mockResolvedValueOnce(workbook())
    const importing = vi.spyOn(store, "importScores")
    await upload(wrapper!)
    await confirmImport(wrapper!)
    expect(confirmation).toHaveBeenCalledOnce()
    changeExam(store)
    await nextTick()
    const cache = localStorage.getItem(CacheKey.GRADEBOOK_DATA)
    const records = JSON.stringify(store.workspace.records)
    const writing = vi.spyOn(Storage.prototype, "setItem")
    confirming.resolve("confirm" as Awaited<ReturnType<typeof ElMessageBox.confirm>>)
    await flushPromises()
    expect(importing).not.toHaveBeenCalled()
    expect(writing).not.toHaveBeenCalled()
    expect(JSON.stringify(store.workspace.records)).toBe(records)
    expect(localStorage.getItem(CacheKey.GRADEBOOK_DATA)).toBe(cache)
    expect(ElMessage.error).toHaveBeenCalledWith("考试或学科配置已变化，请重新上传成绩文件")
  })

  it("旧预览被拒绝后可重新上传，并按修改后的满分正常导入和持久保存", async () => {
    const confirming = deferred<Awaited<ReturnType<typeof ElMessageBox.confirm>>>()
    vi.spyOn(ElMessageBox, "confirm")
      .mockReturnValueOnce(confirming.promise)
      .mockResolvedValueOnce("confirm" as Awaited<ReturnType<typeof ElMessageBox.confirm>>)
    vi.mocked(readScoreFile).mockResolvedValueOnce(workbook()).mockResolvedValueOnce(workbook(120))
    const importing = vi.spyOn(store, "importScores")
    await upload(wrapper!)
    await confirmImport(wrapper!)
    changeExam(store)
    await nextTick()
    confirming.resolve("confirm" as Awaited<ReturnType<typeof ElMessageBox.confirm>>)
    await flushPromises()
    expect(importing).not.toHaveBeenCalled()
    await upload(wrapper!)
    await confirmImport(wrapper!)
    await flushPromises()
    expect(readScoreFile).toHaveBeenCalledTimes(2)
    expect(importing).toHaveBeenCalledOnce()
    expect(store.workspace.records[0].scores.math).toBe(120)
    expect(JSON.parse(localStorage.getItem(CacheKey.GRADEBOOK_DATA)!).workspaces[0].records[0].scores.math).toBe(120)
    expect(wrapper!.find("[data-testid=\"import-preview\"]").exists()).toBe(false)
    expect(ElMessage.success).toHaveBeenCalledWith("导入成功，排名与分析已自动更新")
  })
})
