import type { GradebookArchive, Workspace } from "@/pages/gradebook/types"
import { CacheKey } from "@@/constants/cache-key"
import { Workbook } from "exceljs"
import { createPinia, setActivePinia } from "pinia"
import { beforeEach, describe, expect, it } from "vitest"
import { comparableExams, previousExam, rankedStudents, statistics, totalStatistics } from "@/pages/gradebook/analytics"
import { createDemo } from "@/pages/gradebook/demo"
import { csvMatrix, parseScoreMatrix, readScoreFile } from "@/pages/gradebook/files"
import { buildReport, reportHtml } from "@/pages/gradebook/report"
import { parseArchive } from "@/pages/gradebook/validation"
import { useGradebookStore } from "@/pinia/stores/gradebook"

function fixture(): Workspace {
  const subjects = [{ id: "math", name: "数学", max: 100, pass: 60, excellent: 85 }, { id: "chinese", name: "语文", max: 100, pass: 60, excellent: 85 }]
  return {
    id: "teacher",
    name: "教学档案",
    teacher: "陈老师",
    demo: false,
    warningThreshold: 1,
    classes: [{ id: "one", name: "一班" }, { id: "two", name: "二班" }],
    subjects,
    students: ["a", "b", "c", "d", "e"].map((id, i) => ({ id, name: `学生${id}`, number: `00${i + 1}`, classId: id === "e" ? "two" : "one", focus: false, note: "" })),
    exams: [{ id: "old", name: "上次", date: "2026-09-01", subjects: structuredClone(subjects) }, { id: "new", name: "本次", date: "2026-10-01", subjects: structuredClone(subjects) }],
    records: [
      ...[[90, 90], [70, 70], [80, 80], [60, 60], [95, 95]].map(([math, chinese], i) => ({ examId: "old", studentId: "abcde"[i], scores: { math, chinese } })),
      ...[[80, 80], [80, 80], [60, 70], [50, null], [90, 90]].map(([math, chinese], i) => ({ examId: "new", studentId: "abcde"[i], scores: { math, chinese } }))
    ],
    selectedClassId: "one",
    selectedExamId: "new"
  }
}

function archive(data = fixture()): GradebookArchive {
  return { version: 1, activeWorkspaceId: data.id, workspaces: [data] }
}

describe("排名与统计", () => {
  it("同分并列按 1、1、3 排名，缺考按零分参与班级与跨班排名", () => {
    const rows = rankedStudents(fixture(), "new", "one")
    expect(rows.map(row => row.rank)).toEqual([1, 1, 3, 4])
    expect(rows.map(row => row.gradeRank)).toEqual([2, 2, 4, 5])
    expect(rows.map(row => row.total)).toEqual([160, 160, 130, 50])
    expect(rows[3].average).toBe(25)
    expect(rows[3].scores.chinese).toBeNull()
    expect(rows[3].subjectRanks.math).toBe(4)
  })

  it("班级排名进退步按同班上次考试计算，并产生下降预警", () => {
    const rows = rankedStudents(fixture(), "new", "one")
    expect(rows.map(row => row.change)).toEqual([0, 2, -1, 0])
    expect(rows[2].warnings).toContain("退步 1 名")
    expect(rows[3].warnings).toContain("成绩不完整")
    expect(rows[3].warnings).toContain("数学未及格")
  })

  it("单科统计排除缺考，总分统计包含按零分参与排名的学生", () => {
    expect(statistics([0, 60, 85, null, undefined], 60, 85)).toEqual({ count: 3, average: 48.3, max: 85, min: 0, passRate: 66.7, excellentRate: 33.3 })
    const data = fixture()
    const rows = rankedStudents(data, "new", "one")
    expect(totalStatistics(rows, data.exams[1])).toEqual({ count: 4, average: 125, max: 160, min: 50, passRate: 75, excellentRate: 0 })
    expect(statistics(rows.map(row => row.scores.math), 60, 85).count).toBe(4)
    expect(statistics([], 60, 85).count).toBe(0)
  })

  it("整次未录入、全科缺考及实际零分均按零分同分并列，保留原始缺考标记", () => {
    const data = fixture()
    data.records = data.records.filter(record => record.examId !== "new" || !["b", "c", "d"].includes(record.studentId))
    data.records.push({ examId: "new", studentId: "c", scores: { math: null, chinese: null } }, { examId: "new", studentId: "d", scores: { math: 0, chinese: 0 } })
    const rows = rankedStudents(data, "new", "one")
    expect(rows.map(row => row.total)).toEqual([160, 0, 0, 0])
    expect(rows.map(row => row.average)).toEqual([80, 0, 0, 0])
    expect(rows.map(row => row.rank)).toEqual([1, 2, 2, 2])
    expect(rows.map(row => row.gradeRank)).toEqual([2, 3, 3, 3])
    expect(rows.find(row => row.id === "b")?.scores).toEqual({})
    expect(rows.find(row => row.id === "c")?.scores).toEqual({ math: null, chinese: null })
    expect(rows.find(row => row.id === "d")?.warnings).not.toContain("成绩不完整")
  })

  it("考试科目或满分改变后不生成误导性的排名变化", () => {
    const data = fixture()
    data.exams[0].subjects[0].max = 150
    expect(comparableExams(data.exams[0], data.exams[1])).toBe(false)
    expect(rankedStudents(data, "new", "one").every(row => row.change === null)).toBe(true)
  })

  it("乱序考试按日期找到上次同班考试，忽略无此班数据的考试", () => {
    const data = fixture()
    data.exams.reverse()
    data.exams.push({ ...data.exams[1], id: "other", date: "2026-09-20" })
    data.records.push({ studentId: "e", examId: "other", scores: { math: 80, chinese: 90 } })
    expect(previousExam(data, data.exams[0], "one")?.id).toBe("old")
  })
})

describe("excel 与 CSV 导入", () => {
  it("按学科名称解析而非固定顺序，保留文本学号和缺考", () => {
    const preview = parseScoreMatrix([["姓名", "班级", "语文成绩", "学号", "数学(100分)"], ["小明", "二班", "缺考", "001", 0]], fixture().exams[1], "一班")
    expect(preview.errors).toEqual([])
    expect(preview.rows[0]).toMatchObject({ number: "001", className: "二班", scores: { math: 0, chinese: null } })
  })

  it("拒绝重复学号、姓名缺失、越界成绩与无学科表头", () => {
    const preview = parseScoreMatrix([["学号", "姓名", "数学"], ["001", "小明", 101], ["001", "", "八十分"]], fixture().exams[1], "一班")
    expect(preview.errors).toHaveLength(4)
    expect(parseScoreMatrix([["学号", "姓名", "总分"], ["1", "小明", 180]], fixture().exams[1], "一班").errors).toContain("没有匹配到学科列，请使用本次考试的学科名称或下载模板")
  })

  it("cSV 正确处理逗号、双引号、换行与 UTF-8 BOM", () => {
    expect(csvMatrix("\uFEFF学号,姓名,数学\r\n001,\"陈,小明\",80\r\n002,\"张\"\"三\",90")).toEqual([["\uFEFF学号", "姓名", "数学"], ["001", "陈,小明", "80"], ["002", "张\"三", "90"]])
    expect(() => csvMatrix("001,\"小明")).toThrow("CSV 引号未闭合")
  })

  it("读取真实的多工作表 xlsx，支持公式缓存结果", async () => {
    const workbook = new Workbook()
    const sheet = workbook.addWorksheet("一班")
    sheet.addRow(["学号", "姓名", "数学", "语文"])
    sheet.addRow(["001", "小明", { formula: "40+40", result: 80 }, 90])
    workbook.addWorksheet("二班").addRow(["学号", "姓名", "数学"])
    const file = new File([await workbook.xlsx.writeBuffer()], "成绩.xlsx")
    const sheets = await readScoreFile(file)
    expect(sheets.map(item => item.name)).toEqual(["一班", "二班"])
    const parsed = parseScoreMatrix(sheets[0].matrix, fixture().exams[1], "一班")
    expect(parsed.errors).toEqual([])
    expect(parsed.rows[0].scores.math).toBe(80)
    expect(parsed.rows[0].number).toBe("001")
  })
})

describe("浏览器持久化与数据恢复", () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it("成绩修改同步保存，重建 Store 相当于重新打开浏览器", () => {
    localStorage.setItem(CacheKey.GRADEBOOK_DATA, JSON.stringify(archive()))
    const store = useGradebookStore()
    store.upsertScores({ examId: "new", studentId: "a", scores: { math: 98, chinese: 99 } })
    expect(JSON.parse(localStorage.getItem(CacheKey.GRADEBOOK_DATA)!).workspaces[0].records.find((item: { examId: string, studentId: string }) => item.examId === "new" && item.studentId === "a").scores.math).toBe(98)
    store.$dispose()
    setActivePinia(createPinia())
    expect(useGradebookStore().rows.find(item => item.id === "a")?.total).toBe(197)
  })

  it("多个教师档案数据隔离，备份可完整恢复", () => {
    const store = useGradebookStore()
    const oldId = store.workspace.id
    store.addWorkspace("我的班级", "李老师")
    expect(store.students).toHaveLength(0)
    expect(store.workspace.teacher).toBe("李老师")
    const exported = JSON.parse(JSON.stringify(store.archive))
    store.archive.activeWorkspaceId = oldId
    expect(store.students).toHaveLength(24)
    store.restore(exported)
    expect(store.workspace.name).toBe("我的班级")
    expect(store.archive.workspaces).toHaveLength(2)
  })

  it("同班学号姓名冲突使整次导入回滚，不留下部分班级和成绩", () => {
    localStorage.setItem(CacheKey.GRADEBOOK_DATA, JSON.stringify(archive()))
    const store = useGradebookStore()
    const before = JSON.stringify(store.archive)
    expect(() => store.importScores([
      { line: 2, number: "new", name: "新增", className: "三班", scores: { math: 80 } },
      { line: 3, number: "001", name: "错误姓名", className: "一班", scores: { math: 80 } }
    ])).toThrow("已属于")
    expect(JSON.stringify(store.archive)).toBe(before)
  })

  it("部分学科导入保留其他成绩，空白科目可更新为缺考", () => {
    localStorage.setItem(CacheKey.GRADEBOOK_DATA, JSON.stringify(archive()))
    const store = useGradebookStore()
    store.importScores([{ line: 2, number: "001", name: "学生a", className: "一班", scores: { math: null } }])
    expect(store.rows.find(item => item.id === "a")?.scores).toEqual({ math: null, chinese: 80 })
  })

  it("编辑学生时只保存学生资料，不把动态排名和成绩写入学生名册", () => {
    localStorage.setItem(CacheKey.GRADEBOOK_DATA, JSON.stringify(archive()))
    const store = useGradebookStore()
    store.upsertStudent({ ...store.rows[0], note: "安排一次学习交流" })
    const student = store.workspace.students.find(item => item.id === "a")!
    expect(student.note).toBe("安排一次学习交流")
    expect(student).not.toHaveProperty("total")
    expect(student).not.toHaveProperty("warnings")
    expect(student).not.toHaveProperty("scores")
  })

  it("拒绝无效备份，既有数据保持不变", () => {
    const invalid = archive()
    invalid.workspaces[0].records[0].scores.math = 999
    expect(() => parseArchive(invalid)).toThrow("无效分数")
    const store = useGradebookStore()
    const before = JSON.stringify(store.archive)
    expect(() => store.restore(invalid)).toThrow()
    expect(JSON.stringify(store.archive)).toBe(before)
  })

  it("缓存损坏时保留原始缓存，不用示例数据覆盖", () => {
    localStorage.setItem(CacheKey.GRADEBOOK_DATA, "{invalid")
    const store = useGradebookStore()
    expect(store.loadError).not.toBe("")
    expect(localStorage.getItem(CacheKey.GRADEBOOK_DATA)).toBe("{invalid")
    expect(store.students).toHaveLength(0)
  })
})

describe("报告", () => {
  it("缺考学生报告保留缺考标记并显示总分、排名和趋势，不生成 NaN 建议", () => {
    const report = buildReport(fixture(), "student", "d")
    expect(report.metrics[0].value).toBe(50)
    expect(report.metrics[1].value).toBe(4)
    expect(report.trend?.map(item => item.value)).toEqual([60, 25])
    const html = reportHtml(report)
    expect(html).toContain("缺考 / 未录入")
    expect(html).toContain("按 0 分")
    expect(html).not.toContain("NaN")
  })
  it("个人报告含学科排名、历史记录与学习建议，内容转义避免 HTML 注入", () => {
    const data = fixture()
    data.students[0].name = "<img src=x onerror=\"alert(1)\">"
    const report = buildReport(data, "student", "a")
    const html = reportHtml(report)
    expect(report.tables[1].rows).toHaveLength(2)
    expect(report.sections[0].paragraphs.length).toBeGreaterThan(1)
    expect(html).toContain("&lt;img")
    expect(html).not.toContain("<img src=x onerror=\"alert(1)\">")
  })

  it("所有示例成绩与三种报告均可生成、序列化和校验", () => {
    const data = createDemo()
    expect(parseArchive(archive(data)).workspaces[0].records).toHaveLength(144)
    expect(buildReport(data, "class").metrics[3].value).toBe("24 / 24")
    expect(buildReport(data, "subject", "math").tables[0].rows).toHaveLength(2)
    for (const student of data.students.filter(item => item.classId === data.selectedClassId)) expect(reportHtml(buildReport(data, "student", student.id))).toContain("学习建议")
  })
})
