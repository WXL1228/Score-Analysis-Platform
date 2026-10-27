import type { Exam } from "@/pages/gradebook/types"
import { Workbook } from "exceljs"
import { createPinia, setActivePinia } from "pinia"
import { beforeEach, describe, expect, it } from "vitest"
import { buildScoreWorkbook, inferSubjects, parseClassScoreMatrix, parseScoreMatrix, readScoreFile } from "@/pages/gradebook/files"
import { parseArchive } from "@/pages/gradebook/validation"
import { useGradebookStore } from "@/pinia/stores/gradebook"

// 按用户成绩单结构匿名化：首列无表头，底部只有两科平均分。
const matrix = [[null, "姓名", "性别", "数学", "英语", null], [1, "测试甲", "男", 86, 98], [2, "测试乙", "女", 88.5, 91], [null, null, null, 87.25, 94.5]]
const subjects = [{ id: "math", name: "数学", max: 100, pass: 60, excellent: 85 }, { id: "english", name: "英语", max: 100, pass: 60, excellent: 85 }]
const exam: Exam = { id: "exam", name: "摸底考试", date: "2026-10-14", subjects }
const templateSubjects = ["语文", "数学", "英语", "道法", "物理", "化学", "生物", "历史", "地理"]

function initialize() {
  const store = useGradebookStore()
  store.addWorkspace("模板测试", "老师")
  store.initializeClass({ name: "一班", exam, rows: parseClassScoreMatrix(matrix, subjects, "一班").rows, setDefaultSubjects: true })
  return store
}

describe("成绩单导入导出模板", () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it("识别无表头序号、性别和小数分数，跳过底部平均分", async () => {
    expect(inferSubjects(matrix, subjects)).toEqual(subjects)
    const workbook = new Workbook()
    const sheet = workbook.addWorksheet("Sheet1")
    matrix.forEach(row => sheet.addRow(row))
    sheet.getCell("D4").value = { formula: "AVERAGE(D2:D3)", result: 87.25 }
    sheet.getCell("E4").value = { formula: "AVERAGE(E2:E3)", result: 94.5 }
    const loaded = await readScoreFile(new File([await workbook.xlsx.writeBuffer()], "摸底考试.xlsx"))
    const result = parseScoreMatrix(loaded[0].matrix, exam, "一班")
    expect(result.errors).toEqual([])
    expect(result.rows).toHaveLength(2)
    expect(result.rows[1]).toMatchObject({ number: "", name: "测试乙", gender: "女", scores: { math: 88.5, english: 91 }, line: 3 })
  })

  it("自动编号并保留性别，改变序号和顺序重复导入仍更新同一学生", () => {
    const store = initialize()
    const ids = store.students.map(student => student.id)
    expect(store.students.map(student => student.number)).toEqual(["自动001", "自动002"])
    const reordered = [["序号", "姓名", "性别", "数学", "英语"], [1, "测试乙", "女", 90, 93], [2, "测试甲", "男", 80, 95]]
    store.importScores(parseScoreMatrix(reordered, store.exam!, "一班").rows)
    expect(store.students.map(student => student.id)).toEqual(ids)
    expect(store.rows.find(student => student.name === "测试乙")?.scores.math).toBe(90)
    const saved = parseArchive(JSON.parse(JSON.stringify(store.archive)))
    store.$dispose()
    setActivePinia(createPinia())
    const reopened = useGradebookStore()
    expect(reopened.students.map(student => student.gender)).toEqual(["男", "女"])
    reopened.restore(saved)
    expect(reopened.students[1].gender).toBe("女")
  })

  it("填写学号时优先用学号，兼容旧格式且无性别列不覆盖性别", () => {
    const store = initialize()
    const parsed = parseScoreMatrix([["序号", "学号", "姓名", "数学"], [99, "自动001", "测试甲", 92]], store.exam!, "一班")
    expect(parsed.errors).toEqual([])
    expect(parsed.rows[0].number).toBe("自动001")
    store.importScores(parsed.rows)
    expect(store.students[0].gender).toBe("男")
    expect(store.rows.find(student => student.name === "测试甲")?.scores).toEqual({ math: 92, english: 98 })
    store.upsertStudent({ ...store.students[0], note: "备注" })
    expect(store.students[0].gender).toBe("男")
  })

  it("同班重名且无学号阻止导入，已有重名匹配失败时不写入任何成绩", () => {
    const parsed = parseScoreMatrix([["姓名", "数学"], ["重名", 80], ["重名", 90]], exam, "一班")
    expect(parsed.errors.join()).toContain("请填写学号")
    const mixed = parseScoreMatrix([["学号", "姓名", "数学"], ["001", "重名", 80], [null, "重名", 90]], exam, "一班")
    expect(mixed.errors.join()).toContain("请填写学号")
    const store = initialize()
    store.upsertStudent({ ...store.students[0], id: "duplicate", number: "另一个编号" })
    const before = JSON.stringify(store.archive)
    expect(() => store.importScores([{ line: 2, name: "测试甲", number: "", className: "一班", scores: { math: 90 } }])).toThrow("对应多个学生")
    expect(JSON.stringify(store.archive)).toBe(before)
  })

  it("仍按配置校验满分，缺考保留为空，明确统计行不作学生", () => {
    const parsed = parseScoreMatrix([["姓名", "数学", "英语"], ["测试甲", 101, "缺考"], ["平均分", 50, 60]], exam, "一班")
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rows[0].scores.english).toBeNull()
    expect(parsed.errors.join()).toContain("0～100")
  })

  it("下载模板固定九科且道法不重复，回导当前两科考试时只解析已配置科目", async () => {
    const workbook = await buildScoreWorkbook(exam, "一班")
    const sheet = workbook.worksheets[0]
    expect(sheet.getRow(1).values).toEqual([undefined, "序号", "姓名", "性别", ...templateSubjects, "学号（可选）"])
    expect((sheet.getRow(1).values as unknown[]).filter(value => value === "道法")).toHaveLength(1)
    sheet.getCell("B2").value = "测试甲"
    sheet.getCell("C2").value = "男"
    sheet.getCell("D2").value = 90
    sheet.getCell("E2").value = 86
    sheet.getCell("F2").value = 98
    const loaded = await readScoreFile(new File([await workbook.xlsx.writeBuffer()], "模板.xlsx"))
    const parsed = parseScoreMatrix(loaded[0].matrix, exam, "一班")
    expect(parsed.errors).toEqual([])
    expect(parsed.rows[0]).toMatchObject({ number: "", gender: "男", scores: { math: 86, english: 98 } })
    expect(parsed.rows[0].scores).toEqual({ math: 86, english: 98 })
    const inferred = inferSubjects(loaded[0].matrix, subjects)
    expect(inferred.map(subject => subject.name)).toEqual(templateSubjects)
    for (const subject of subjects) expect(inferred.find(item => item.name === subject.name)).toEqual(subject)
    expect(inferred.filter(subject => !subjects.some(item => item.name === subject.name)).every(subject => subject.max === 100 && subject.pass === 60 && subject.excellent === 85)).toBe(true)
  })

  it("九科顺序不受现有学科顺序影响，自定义额外学科追加且沿用配置分数线", async () => {
    const configured = [
      { id: "music", name: "音乐", max: 50, pass: 30, excellent: 45 },
      { id: "english", name: "英语", max: 120, pass: 72, excellent: 102 },
      { id: "math", name: "数学", max: 150, pass: 90, excellent: 128 },
      { id: "ethics", name: "道法", max: 80, pass: 48, excellent: 68 }
    ]
    const workbook = await buildScoreWorkbook({ ...exam, subjects: configured }, "一班")
    expect(workbook.worksheets[0].getRow(1).values).toEqual([undefined, "序号", "姓名", "性别", ...templateSubjects, "音乐", "学号（可选）"])
    const loaded = await readScoreFile(new File([await workbook.xlsx.writeBuffer()], "自定义模板.xlsx"))
    const inferred = inferSubjects(loaded[0].matrix, configured)
    expect(inferred.map(subject => subject.name)).toEqual([...templateSubjects, "音乐"])
    for (const subject of configured) expect(inferred.find(item => item.name === subject.name)).toEqual(subject)
    expect(inferred.find(subject => subject.name === "语文")).toMatchObject({ max: 100, pass: 60, excellent: 85 })
    const instructions = workbook.getWorksheet("填写说明")!
    const descriptions: Record<string, string> = {}
    instructions.eachRow((row) => {
      descriptions[row.getCell(1).text] = row.getCell(2).text
    })
    expect(descriptions.数学).toBe("满分 150，及格 90，优秀 128")
    expect(descriptions.道法).toBe("满分 80，及格 48，优秀 68")
    expect(descriptions.音乐).toBe("满分 50，及格 30，优秀 45")
  })

  it("尚无考试和班级时也能下载九科模板，空白科目可识别为缺考", async () => {
    const workbook = await buildScoreWorkbook(undefined, "")
    const sheet = workbook.worksheets[0]
    expect(sheet.name).toBe("成绩录入")
    expect(sheet.getRow(1).values).toEqual([undefined, "序号", "姓名", "性别", ...templateSubjects, "学号（可选）"])
    expect(sheet.getColumn(13).numFmt).toBe("@")
    sheet.getCell("B2").value = "测试甲"
    const loaded = await readScoreFile(new File([await workbook.xlsx.writeBuffer()], "空档案模板.xlsx"))
    const inferred = inferSubjects(loaded[0].matrix, [])
    expect(inferred.map(subject => subject.name)).toEqual(templateSubjects)
    const parsed = parseScoreMatrix(loaded[0].matrix, { ...exam, subjects: inferred }, "新班级")
    expect(parsed.errors).toEqual([])
    expect(Object.values(parsed.rows[0].scores)).toEqual(Array.from({ length: 9 }).fill(null))
  })

  it("尚无考试时沿用档案自定义学科，已有考试时优先使用考试配置", async () => {
    const configured = [
      { id: "music", name: "音乐", max: 50, pass: 30, excellent: 45 },
      { id: "math", name: "数学", max: 150, pass: 90, excellent: 128 }
    ]
    const workbook = await buildScoreWorkbook(undefined, "", undefined, configured)
    expect(workbook.worksheets[0].getRow(1).values).toEqual([undefined, "序号", "姓名", "性别", ...templateSubjects, "音乐", "学号（可选）"])
    const descriptions: Record<string, string> = {}
    workbook.getWorksheet("填写说明")!.eachRow((row) => {
      descriptions[row.getCell(1).text] = row.getCell(2).text
    })
    expect(descriptions.音乐).toBe("满分 50，及格 30，优秀 45")
    expect(descriptions.数学).toBe("满分 150，及格 90，优秀 128")

    const examWorkbook = await buildScoreWorkbook(exam, "一班", undefined, configured)
    expect(examWorkbook.worksheets[0].getRow(1).values).toEqual([undefined, "序号", "姓名", "性别", ...templateSubjects, "学号（可选）"])
    const examDescriptions: Record<string, string> = {}
    examWorkbook.getWorksheet("填写说明")!.eachRow((row) => {
      examDescriptions[row.getCell(1).text] = row.getCell(2).text
    })
    expect(examDescriptions.数学).toBe("满分 100，及格 60，优秀 85")
    expect(examDescriptions.音乐).toBeUndefined()
  })

  it("导出序号与内部学号分开，保留性别、排名及平均分，回导不会增加学生", async () => {
    const store = initialize()
    const workbook = await buildScoreWorkbook(store.exam!, "一班", store.rows)
    const sheet = workbook.worksheets[0]
    expect(sheet.getRow(1).values).toEqual([undefined, "序号", "姓名", "性别", "数学", "英语", "学号", "班级", "总分", "平均分", "班级排名", "跨班排名", "排名变化"])
    expect(sheet.getCell("A2").value).toBe(1)
    expect(sheet.getCell("F2").value).toBe(store.rows[0].number)
    expect(sheet.getCell("B4").value).toBe("平均分")
    expect(sheet.getCell("D4").value).toBe(87.25)
    expect(sheet.getCell("E4").value).toBe(94.5)
    const loaded = await readScoreFile(new File([await workbook.xlsx.writeBuffer()], "明细.xlsx"))
    const parsed = parseScoreMatrix(loaded[0].matrix, store.exam!, "一班")
    expect(parsed.errors).toEqual([])
    expect(parsed.rows).toHaveLength(2)
    store.importScores(parsed.rows)
    expect(store.students).toHaveLength(2)
    expect(store.rows.map(row => row.total).sort()).toEqual([179.5, 184])
  })
})
