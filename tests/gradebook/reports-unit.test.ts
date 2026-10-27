import type { VueWrapper } from "@vue/test-utils"
import type { ReportDocument } from "@/pages/gradebook/report"
import type { Workspace } from "@/pages/gradebook/types"
import { CacheKey } from "@@/constants/cache-key"
import { flushPromises, mount } from "@vue/test-utils"
import { ElMessage, ElRadioGroup, ElSelect } from "element-plus/es"
import { createPinia, setActivePinia } from "pinia"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createWorkspace } from "@/pages/gradebook/demo"
import Reports from "@/pages/gradebook/Reports.vue"
import { useGradebookStore } from "@/pinia/stores/gradebook"

const mocks = vi.hoisted(() => ({ render: vi.fn(), download: vi.fn(), zipFile: vi.fn(), zipGenerate: vi.fn() }))
vi.mock("@/pages/gradebook/export-pdf", () => ({ renderPdf: mocks.render }))
vi.mock("@/pages/gradebook/files", async importOriginal => ({ ...await importOriginal<typeof import("@/pages/gradebook/files")>(), downloadBlob: mocks.download }))
vi.mock("jszip", () => ({ default: class {
  file(name: string, blob: Blob) {
    mocks.zipFile(name, blob)
  }

  generateAsync(options: { type: string }) {
    return mocks.zipGenerate(options)
  }
} }))

let wrapper: VueWrapper | undefined

function fixture(): Workspace {
  const data = createWorkspace("单元报告档案", "测试教师")
  data.subjects = [{ id: "math", name: "数学", max: 100, pass: 60, excellent: 85 }]
  data.classes = [{ id: "class-a", name: "一班" }, { id: "class-b", name: "二班" }]
  data.students = [
    { id: "a", number: "001", name: "学生甲", classId: "class-a", focus: false, note: "" },
    { id: "b", number: "002", name: "学生乙", classId: "class-a", focus: false, note: "" },
    { id: "c", number: "003", name: "暂无单元记录", classId: "class-a", focus: false, note: "" },
    { id: "d", number: "004", name: "二班学生", classId: "class-b", focus: false, note: "" }
  ]
  data.unitPlans = [
    {
      id: "plan-a",
      name: "数学单元跟进",
      classId: "class-a",
      subjectId: "math",
      periods: [{ id: "unit-1", name: "第一单元" }, { id: "unit-2", name: "第二单元" }],
      entries: [
        { studentId: "a", baseline: 50, level: "B", task: "基础巩固", scores: { "unit-1": { target: 60, actual: 70 }, "unit-2": { target: 80, actual: null } } },
        { studentId: "b", baseline: 40, level: "C", task: "补充练习", scores: { "unit-1": { target: 50, actual: 45 }, "unit-2": { target: 55, actual: 50 } } }
      ]
    },
    { id: "empty-plan", name: "空计划", classId: "class-a", subjectId: "math", periods: [{ id: "unit-1", name: "第一单元" }], entries: [] },
    {
      id: "plan-b",
      name: "二班数学跟进",
      classId: "class-b",
      subjectId: "math",
      periods: [{ id: "unit-1", name: "第一单元" }],
      entries: [{ studentId: "d", baseline: 80, level: "A", task: "拓展任务", scores: { "unit-1": { target: 90, actual: 95 } } }]
    }
  ]
  data.selectedClassId = "class-a"
  return data
}

async function open(data = fixture()) {
  localStorage.setItem(CacheKey.GRADEBOOK_DATA, JSON.stringify({ version: 1, activeWorkspaceId: data.id, workspaces: [data] }))
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useGradebookStore()
  wrapper = mount(Reports, { global: { plugins: [pinia], stubs: {
    RouterLink: { props: ["to"], template: "<a><slot /></a>" },
    ElSelect: { name: "ElSelect", props: ["modelValue", "disabled"], emits: ["update:modelValue"], template: "<div><slot /></div>" },
    ElOption: { name: "ElOption", props: ["value", "label"], template: "<span />" }
  } } })
  await flushPromises()
  return { view: wrapper, store }
}

function optionIds(view: VueWrapper) {
  return view.findAllComponents({ name: "ElOption" }).map(option => option.props("value"))
}

async function selectKind(view: VueWrapper, kind: string) {
  view.findComponent(ElRadioGroup).vm.$emit("update:modelValue", kind)
  await flushPromises()
}

describe("报告中心单元记录个人报告", () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.render.mockReset().mockResolvedValue(new Blob(["pdf"], { type: "application/pdf" }))
    mocks.download.mockReset()
    mocks.zipFile.mockReset()
    mocks.zipGenerate.mockReset().mockResolvedValue(new Blob(["zip"], { type: "application/zip" }))
    vi.spyOn(ElMessage, "error").mockImplementation(() => ({ close: () => {} }))
    vi.spyOn(ElMessage, "success").mockImplementation(() => ({ close: () => {} }))
    vi.spyOn(ElMessage, "info").mockImplementation(() => ({ close: () => {} }))
  })
  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    vi.restoreAllMocks()
  })

  it("没有普通考试时默认预览可报告学生，单个PDF包含该生单元目标、分层、任务和建议", async () => {
    const { view } = await open()
    expect(optionIds(view)).toEqual(["a", "b"])
    expect(view.findComponent(ElRadioGroup).props("modelValue")).toBe("student")
    expect(view.get("[aria-label=\"报告预览\"]").text()).toContain("学生甲的个人成长报告")
    expect(view.text()).toContain("当前没有普通考试")
    expect(view.text()).toContain("来源未提供日期的单元记录不绑定所选考试")
    expect(view.get("[aria-label=\"批量导出学生 PDF\"]").text()).toContain("2 份 ZIP")
    await view.get("[aria-label=\"导出当前报告 PDF\"]").trigger("click")
    await flushPromises()
    const document = mocks.render.mock.calls[0][0]
    expect(document).toMatchObject({ title: "学生甲的个人成长报告", unitOnly: true, unitPlans: [{ title: "数学单元跟进", level: "B", task: "基础巩固", baseline: 50, rows: [{ period: "第一单元", target: 60, actual: 70, gap: 10, change: 20 }, { period: "第二单元", actual: null, change: null }] }] })
    expect(document.unitPlans[0].advice.join()).toContain("基础巩固")
    expect(mocks.download).toHaveBeenCalledWith(expect.any(Blob), "学生甲的个人成长报告-单元教学.pdf")
    expect(ElMessage.error).not.toHaveBeenCalled()
    await selectKind(view, "class")
    expect(view.find("[aria-label=\"报告预览\"]").exists()).toBe(false)
    expect(view.get("[aria-label=\"导出当前报告 PDF\"]").attributes("disabled")).toBeDefined()
    expect(view.text()).toContain("班级整体报告和单科分析报告需要普通考试")
    await selectKind(view, "subject")
    expect(view.get("[aria-label=\"导出当前报告 PDF\"]").attributes("disabled")).toBeDefined()
  })

  it("批量仅打包本班有单元记录的学生，过程中切班和修改任务仍使用开始时的完整快照", async () => {
    const { view, store } = await open()
    let complete: (blob: Blob) => void = () => {}
    mocks.render.mockImplementationOnce(() => new Promise<Blob>((resolve) => {
      complete = resolve
    }))
    await view.get("[aria-label=\"批量导出学生 PDF\"]").trigger("click")
    await flushPromises()
    expect(mocks.render).toHaveBeenCalledOnce()
    expect(view.text()).toContain("正在生成 0 / 2 份报告")
    store.workspace.unitPlans![0].entries[1].task = "界面新任务"
    store.workspace.selectedClassId = "class-b"
    complete(new Blob(["first pdf"]))
    await flushPromises()
    expect(mocks.render).toHaveBeenCalledTimes(2)
    expect(mocks.render.mock.calls.map(call => call[0].title)).toEqual(["学生甲的个人成长报告", "学生乙的个人成长报告"])
    expect(mocks.render.mock.calls[1][0]).toMatchObject({ unitOnly: true, unitPlans: [{ task: "补充练习", level: "C", rows: [{ actual: 45 }, { target: 55, actual: 50, gap: -5, change: 5 }] }] })
    expect(mocks.zipFile.mock.calls.map(call => call[0])).toEqual(["001-学生甲.pdf", "002-学生乙.pdf"])
    expect(mocks.zipGenerate).toHaveBeenCalledWith({ type: "blob" })
    expect(mocks.download).toHaveBeenCalledWith(expect.any(Blob), "一班-单元教学-学生报告.zip")
    expect(ElMessage.success).toHaveBeenLastCalledWith("已打包 2 份独立学生 PDF")
  })

  it("更新教师评价后预览立即同步，切换学生与单份及批量PDF均使用本人评价", async () => {
    const { view, store } = await open()
    const firstNote = "学生甲善于表达，请保持每日复盘。"
    const secondNote = "学生乙书写有进步，请坚持基础巩固。"
    expect(view.get("[aria-label=\"报告预览\"]").text()).not.toContain("教师评价")
    store.upsertStudent({ ...store.students.find(student => student.id === "a")!, note: firstNote })
    store.upsertStudent({ ...store.students.find(student => student.id === "b")!, note: secondNote })
    await flushPromises()
    expect(view.get("[aria-label=\"报告预览\"]").text()).toContain("教师评价")
    expect(view.get("[aria-label=\"报告预览\"]").text()).toContain(firstNote)
    expect(view.get("[aria-label=\"报告预览\"]").text()).not.toContain(secondNote)

    view.findComponent(ElSelect).vm.$emit("update:modelValue", "b")
    await flushPromises()
    expect(view.get("[aria-label=\"报告预览\"]").text()).toContain("学生乙的个人成长报告")
    expect(view.get("[aria-label=\"报告预览\"]").text()).toContain(secondNote)
    expect(view.get("[aria-label=\"报告预览\"]").text()).not.toContain(firstNote)
    await view.get("[aria-label=\"导出当前报告 PDF\"]").trigger("click")
    await flushPromises()
    expect(mocks.render).toHaveBeenCalledOnce()
    const single = mocks.render.mock.calls[0][0] as ReportDocument
    expect(single.title).toBe("学生乙的个人成长报告")
    expect(single.sections.filter(section => section.title === "教师评价")).toEqual([{ title: "教师评价", paragraphs: [secondNote] }])
    expect(JSON.stringify(single.sections)).not.toContain(firstNote)

    mocks.render.mockClear()
    mocks.download.mockClear()
    mocks.zipFile.mockClear()
    mocks.zipGenerate.mockClear()
    await view.get("[aria-label=\"批量导出学生 PDF\"]").trigger("click")
    await flushPromises()
    expect(mocks.render).toHaveBeenCalledTimes(2)
    expect(mocks.render.mock.calls.map(([document]) => ({
      title: document.title,
      comments: (document as ReportDocument).sections.filter(section => section.title === "教师评价")
    }))).toEqual([
      { title: "学生甲的个人成长报告", comments: [{ title: "教师评价", paragraphs: [firstNote] }] },
      { title: "学生乙的个人成长报告", comments: [{ title: "教师评价", paragraphs: [secondNote] }] }
    ])
    expect(mocks.zipFile.mock.calls.map(call => call[0])).toEqual(["001-学生甲.pdf", "002-学生乙.pdf"])
    expect(ElMessage.error).not.toHaveBeenCalled()
  })

  it("班级和单元条目变化会重新选择有效学生，手动切换班级报告可保留空状态提示", async () => {
    const { view, store } = await open()
    view.findComponent(ElSelect).vm.$emit("update:modelValue", "b")
    await flushPromises()
    expect(view.get("[aria-label=\"报告预览\"]").text()).toContain("学生乙的个人成长报告")
    store.workspace.selectedClassId = "class-b"
    await flushPromises()
    expect(optionIds(view)).toEqual(["d"])
    expect(view.findComponent(ElSelect).props("modelValue")).toBe("d")
    expect(view.get("[aria-label=\"报告预览\"]").text()).toContain("二班学生的个人成长报告")
    await selectKind(view, "class")
    await flushPromises()
    expect(view.findComponent(ElRadioGroup).props("modelValue")).toBe("class")
    expect(view.find("[aria-label=\"报告预览\"]").exists()).toBe(false)
    store.workspace.selectedClassId = "class-a"
    await flushPromises()
    store.workspace.unitPlans![0].entries = store.workspace.unitPlans![0].entries.filter(entry => entry.studentId !== "a")
    await flushPromises()
    expect(optionIds(view)).toEqual(["b"])
    expect(view.findComponent(ElSelect).props("modelValue")).toBe("b")
    store.workspace.unitPlans![0].entries = []
    await flushPromises()
    expect(optionIds(view)).toEqual([])
    expect(view.find("[aria-label=\"报告预览\"]").exists()).toBe(false)
    expect(view.get("[aria-label=\"批量导出学生 PDF\"]").attributes("disabled")).toBeDefined()
  })

  it.each([undefined, []])("没有普通考试且单元计划为 %s 时禁止生成空报告", async (unitPlans) => {
    const data = fixture()
    data.unitPlans = unitPlans
    const { view } = await open(data)
    await selectKind(view, "student")
    expect(optionIds(view)).toEqual([])
    expect(view.find("[aria-label=\"报告预览\"]").exists()).toBe(false)
    expect(view.get("[aria-label=\"导出当前报告 PDF\"]").attributes("disabled")).toBeDefined()
    expect(view.get("[aria-label=\"批量导出学生 PDF\"]").attributes("disabled")).toBeDefined()
    expect(mocks.render).not.toHaveBeenCalled()
    expect(mocks.download).not.toHaveBeenCalled()
    expect(ElMessage.error).not.toHaveBeenCalled()
  })

  it("切换档案和删除所选考试后重算名单，不保留无法生成报告的学生", async () => {
    const { view, store } = await open()
    const originalId = store.workspace.id
    store.addWorkspace("另一份空档案", "")
    await flushPromises()
    expect(optionIds(view)).toEqual([])
    expect(view.find("[aria-label=\"报告预览\"]").exists()).toBe(false)
    store.archive.activeWorkspaceId = originalId
    await flushPromises()
    expect(optionIds(view)).toEqual(["a", "b"])
    expect(view.findComponent(ElSelect).props("modelValue")).toBe("a")
    store.upsertExam({ id: "temporary-exam", name: "临时考试", date: "2026-10-16", subjects: store.workspace.subjects.map(subject => ({ ...subject })) })
    await flushPromises()
    expect(optionIds(view)).toEqual(["a", "b", "c"])
    view.findComponent(ElSelect).vm.$emit("update:modelValue", "c")
    await flushPromises()
    expect(view.get("[aria-label=\"报告预览\"]").text()).toContain("暂无单元记录的个人成长报告")
    store.deleteExam("temporary-exam")
    await flushPromises()
    expect(optionIds(view)).toEqual(["a", "b"])
    expect(view.findComponent(ElSelect).props("modelValue")).toBe("a")
    expect(view.get("[aria-label=\"报告预览\"]").text()).toContain("学生甲的个人成长报告")
    expect(ElMessage.error).not.toHaveBeenCalled()
  })

  it("旧档案有普通考试而没有unitPlans时仍可批量生成本班所有学生报告", async () => {
    const data = fixture()
    delete data.unitPlans
    data.exams = [{ id: "exam", name: "期中考试", date: "2026-10-16", subjects: data.subjects.map(subject => ({ ...subject })) }]
    data.selectedExamId = "exam"
    const { view } = await open(data)
    await selectKind(view, "student")
    expect(optionIds(view)).toEqual(["a", "b", "c"])
    await view.get("[aria-label=\"批量导出学生 PDF\"]").trigger("click")
    await flushPromises()
    expect(mocks.render).toHaveBeenCalledTimes(3)
    expect(mocks.render.mock.calls.every(call => !call[0].unitOnly && call[0].unitPlans.length === 0)).toBe(true)
    expect(mocks.render.mock.calls[2][0].title).toBe("暂无单元记录的个人成长报告")
    expect(mocks.download).toHaveBeenCalledWith(expect.any(Blob), "一班-期中考试-学生报告.zip")
    expect(ElMessage.error).not.toHaveBeenCalled()
  })

  it("取消批量导出时不下载半份报告包", async () => {
    const { view } = await open()
    let complete: (blob: Blob) => void = () => {}
    mocks.render.mockImplementationOnce(() => new Promise<Blob>((resolve) => {
      complete = resolve
    }))
    await view.get("[aria-label=\"批量导出学生 PDF\"]").trigger("click")
    await flushPromises()
    await view.get("[aria-label=\"取消批量导出\"]").trigger("click")
    complete(new Blob(["first pdf"]))
    await flushPromises()
    expect(mocks.render).toHaveBeenCalledOnce()
    expect(mocks.zipGenerate).not.toHaveBeenCalled()
    expect(mocks.download).not.toHaveBeenCalled()
    expect(ElMessage.info).toHaveBeenCalledWith("已取消，未下载不完整的报告包")
    expect(view.get("[aria-label=\"批量导出学生 PDF\"]").attributes("disabled")).toBeUndefined()
  })
})
