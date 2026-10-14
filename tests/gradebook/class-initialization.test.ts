import type { ClassInitialization } from "@/pages/gradebook/types"
import { CacheKey } from "@@/constants/cache-key"
import { createPinia, setActivePinia } from "pinia"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { inferSubjects, parseClassScoreMatrix } from "@/pages/gradebook/files"
import { parseArchive } from "@/pages/gradebook/validation"
import { useGradebookStore } from "@/pinia/stores/gradebook"

const MATRIX = [
  ["学号", "姓名", "班级", "语文成绩", "数学（150分）", "地理", "总分", "平均分", "语文排名", "备注"],
  ["001", "测试甲", "来源班级", 80, 120, 85, 285, 95, 2, ""],
  ["002", "测试乙", "来源班级", 90, 135, 75, 300, 100, 1, ""],
  ["003", "测试丙", "来源班级", "缺考", 100, 70, "", "", "", ""]
]

function inputFor(store: ReturnType<typeof useGradebookStore>): ClassInitialization {
  const subjects = inferSubjects(MATRIX, store.workspace.subjects)
  const preview = parseClassScoreMatrix(MATRIX, subjects, "新建测试班")
  return { name: "新建测试班", exam: { name: "首次月考", date: "2026-10-14", subjects }, rows: preview.rows, setDefaultSubjects: true }
}

describe("新建班级上传成绩单初始化", () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it("新档案没有默认班级，首次导入只创建一个班级且刷新后保留", () => {
    const store = useGradebookStore()
    store.addWorkspace("空白教学档案", "测试老师")
    expect(store.workspace.classes).toEqual([])
    expect(store.workspace.selectedClassId).toBe("")
    expect(store.workspace.students).toEqual([])
    expect(store.workspace.exams).toEqual([])
    expect(store.workspace.records).toEqual([])
    const cached = parseArchive(JSON.parse(localStorage.getItem(CacheKey.GRADEBOOK_DATA)!))
    expect(cached.workspaces.find(item => item.id === cached.activeWorkspaceId)?.classes).toEqual([])
    const group = store.initializeClass(inputFor(store))
    expect(store.workspace.classes).toEqual([group])
    expect(store.students).toHaveLength(3)
    expect(store.workspace.exams).toHaveLength(1)
    store.$dispose()
    setActivePinia(createPinia())
    const reopened = useGradebookStore()
    expect(reopened.loadError).toBe("")
    expect(reopened.workspace.classes).toEqual([group])
    expect(reopened.students).toHaveLength(3)
    expect(reopened.exam?.name).toBe("首次月考")
  })

  it("识别新学科和表头满分，忽略总分、排名和学生资料列", () => {
    const store = useGradebookStore()
    const subjects = inferSubjects(MATRIX, store.workspace.subjects)
    expect(subjects.map(subject => subject.name)).toEqual(["语文", "数学", "地理"])
    expect(subjects[1]).toMatchObject({ id: "math", max: 150, pass: 90, excellent: 127.5 })
    expect(subjects[2]).toMatchObject({ max: 100, pass: 60, excellent: 85 })
    expect(subjects[0].id).toBe("chinese")
  })

  it("统一归入新班级，保留学号前导零与缺考", () => {
    const store = useGradebookStore()
    const input = inputFor(store)
    expect(input.rows).toHaveLength(3)
    expect(input.rows.every(row => row.className === "新建测试班")).toBe(true)
    expect(input.rows[0].number).toBe("001")
    expect(input.rows[2].scores.chinese).toBeNull()
    expect(parseClassScoreMatrix(MATRIX, input.exam!.subjects, input.name).errors).toEqual([])
  })

  it("总成绩、平均成绩不误识别为学科，支持满分标注中的空格", () => {
    const subjects = inferSubjects([["学号", "姓名", "数学 ( 满分 150 分 )", "总成绩", "平均成绩"], ["001", "测试甲", 120, 120, 120]], [])
    expect(subjects.map(subject => subject.name)).toEqual(["数学"])
    expect(subjects[0].max).toBe(150)
  })

  it("一次创建班级、学生、科目与首次考试，并计算总分和排名", () => {
    const store = useGradebookStore()
    const oldExams = JSON.stringify(store.workspace.exams)
    const oldStudents = JSON.stringify(store.workspace.students)
    const oldRecords = JSON.stringify(store.workspace.records)
    const input = inputFor(store)
    const group = store.initializeClass(input)
    expect(store.schoolClass.id).toBe(group.id)
    expect(store.students).toHaveLength(3)
    expect(store.workspace.subjects.map(subject => subject.name)).toEqual(["语文", "数学", "地理"])
    expect(store.exam?.name).toBe("首次月考")
    expect(store.exam?.subjects).toEqual(input.exam!.subjects)
    expect(store.rows.map(row => row.total)).toEqual([300, 285, 170])
    expect(store.rows.map(row => row.rank)).toEqual([1, 2, 3])
    expect(store.rows[0].average).toBe(100)
    expect(JSON.stringify(store.workspace.exams.slice(0, 3))).toBe(oldExams)
    expect(JSON.stringify(store.workspace.students.slice(0, 48))).toBe(oldStudents)
    expect(JSON.stringify(store.workspace.records.slice(0, 144))).toBe(oldRecords)
  })

  it("只写入一份完整缓存，刷新与备份恢复均可读取初始化结果", () => {
    const store = useGradebookStore()
    const original = localStorage.setItem.bind(localStorage)
    const writes: unknown[] = []
    const spy = vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
      if (key === CacheKey.GRADEBOOK_DATA) writes.push(JSON.parse(value))
      original(key, value)
    })
    try {
      store.initializeClass(inputFor(store))
    } finally {
      spy.mockRestore()
    }
    expect(writes).toHaveLength(1)
    expect(() => parseArchive(writes[0])).not.toThrow()
    store.$dispose()
    setActivePinia(createPinia())
    const reopened = useGradebookStore()
    expect(reopened.loadError).toBe("")
    expect(reopened.students).toHaveLength(3)
    expect(reopened.exam?.name).toBe("首次月考")
  })

  it("错误成绩或重复学号不会留下半个班级或考试", () => {
    const store = useGradebookStore()
    const before = JSON.stringify(store.archive)
    const invalid = inputFor(store)
    invalid.rows[0].scores.math = 999
    expect(() => store.initializeClass(invalid)).toThrow("无效分数")
    expect(JSON.stringify(store.archive)).toBe(before)
    const duplicate = inputFor(store)
    duplicate.rows[1].number = duplicate.rows[0].number
    expect(() => store.initializeClass(duplicate)).toThrow("学号不能重复")
    expect(JSON.stringify(store.archive)).toBe(before)
  })

  it("同名班级被阻止，多班级工作表不会合并导入", () => {
    const store = useGradebookStore()
    const input = inputFor(store)
    input.name = store.schoolClass.name
    expect(() => store.initializeClass(input)).toThrow("重复")
    const mixed = MATRIX.map(row => [...row])
    mixed[2][2] = "其他班级"
    expect(parseClassScoreMatrix(mixed, input.exam!.subjects, "测试班").errors[0]).toContain("多个班级")
  })

  it("可取消非学科列，未知科目必须调整满分才能导入越界成绩", () => {
    const matrix = [["学号", "姓名", "生物", "自定义资料"], ["001", "测试甲", 120, "文本"]]
    const subjects = inferSubjects(matrix, [])
    const chosen = subjects.filter(subject => subject.name === "生物")
    expect(parseClassScoreMatrix(matrix, chosen, "测试班").errors[0]).toContain("0～100")
    chosen[0].max = 150
    expect(parseClassScoreMatrix(matrix, chosen, "测试班").errors).toEqual([])
  })

  it("可保留现有默认学科，首次考试快照不随设置修改", () => {
    const store = useGradebookStore()
    const defaults = JSON.stringify(store.workspace.subjects)
    const input = inputFor(store)
    input.setDefaultSubjects = false
    store.initializeClass(input)
    expect(JSON.stringify(store.workspace.subjects)).toBe(defaults)
    const examMath = store.exam!.subjects.find(subject => subject.id === "math")!
    store.workspace.subjects.find(subject => subject.id === "math")!.max = 200
    expect(examMath.max).toBe(150)
  })

  it("不上传成绩单仍可创建空白班级", () => {
    const store = useGradebookStore()
    const count = store.workspace.exams.length
    store.initializeClass({ name: "空白班级", rows: [], setDefaultSubjects: false })
    expect(store.schoolClass.name).toBe("空白班级")
    expect(store.students).toEqual([])
    expect(store.workspace.exams).toHaveLength(count)
  })
})
