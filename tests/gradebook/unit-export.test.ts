import type { Student, UnitTrackingPlan } from "@/pages/gradebook/types"
import { describe, expect, it, vi } from "vitest"
import { downloadBlob, readScoreFile } from "@/pages/gradebook/files"
import { exportUnitWorkbook } from "@/pages/gradebook/unit-export"
import { parseUnitWorkbook, unitBaselineRanks, unitDifference, unitRankings } from "@/pages/gradebook/unit-tracking"

vi.mock("@/pages/gradebook/files", async importOriginal => ({
  ...await importOriginal<typeof import("@/pages/gradebook/files")>(),
  downloadBlob: vi.fn()
}))

describe("单元计划 Excel 导出回读", () => {
  it("未分配任务的学生不会在导出再导入时继承其他学生的任务", async () => {
    vi.mocked(downloadBlob).mockClear()
    const students: Student[] = ["a", "b", "c"].map((id, index) => ({ id, number: `00${index + 1}`, name: `学生${id}`, classId: "class", focus: false, note: "" }))
    const plan: UnitTrackingPlan = {
      id: "plan",
      name: "单元计划",
      classId: "class",
      subjectId: "math",
      periods: [{ id: "unit-1", name: "1单元" }],
      entries: students.map((student, index) => ({ studentId: student.id, baseline: 60, level: "B", task: index === 1 ? "提升任务" : "", scores: { "unit-1": { target: 80, actual: 70 } } }))
    }
    await exportUnitWorkbook(plan, students, "一班", "数学")
    const [blob, name] = vi.mocked(downloadBlob).mock.lastCall!
    const preview = parseUnitWorkbook(await readScoreFile(new File([blob], name)), 100)
    expect(preview.errors).toEqual([])
    expect(preview.rows.map(row => row.task)).toEqual(["", "提升任务", ""])
    expect(preview.warnings.join()).toContain("2 名学生未分配作业任务")
  })

  it("保留前导零学号、性别、分层、独立任务及缺考；真实零参与计算，空白不生成假退步", async () => {
    vi.mocked(downloadBlob).mockClear()
    const students: Student[] = [
      { id: "student-a", number: "001", name: "学生甲", gender: "男", classId: "class-a", focus: false, note: "" },
      { id: "student-b", number: "002", name: "学生乙", gender: "女", classId: "class-a", focus: false, note: "" }
    ]
    const plan: UnitTrackingPlan = {
      id: "plan-a",
      name: "学期单元计划",
      classId: "class-a",
      subjectId: "math",
      periods: [{ id: "unit-1", name: "第1单元" }, { id: "unit-2", name: "第2单元" }],
      entries: [
        { studentId: "student-a", baseline: 50, level: "A", task: "基础巩固", scores: { "unit-1": { target: 70, actual: null }, "unit-2": { target: 0, actual: 0 } } },
        { studentId: "student-b", baseline: 40, level: "B", task: "拓展练习", scores: { "unit-1": { target: 50, actual: 60 }, "unit-2": { target: 60, actual: 55 } } }
      ]
    }

    await exportUnitWorkbook(plan, students, "七年级三班", "数学")
    expect(downloadBlob).toHaveBeenCalledOnce()
    const [blob, fileName] = vi.mocked(downloadBlob).mock.lastCall!
    expect(fileName).toBe("七年级三班-数学-学期单元计划.xlsx")
    const sheets = await readScoreFile(new File([blob], fileName, { type: blob.type }))
    expect(sheets.map(sheet => sheet.name)).toEqual(["单元目标", "作业分组"])
    const [header, first, second] = sheets[0].matrix
    const firstActual = header.indexOf("1单元测试")
    const secondActual = header.indexOf("2单元测试")
    expect(first[header.indexOf("学情调研排名")]).toBe(1)
    expect(second[header.indexOf("学情调研排名")]).toBe(2)
    expect(first.slice(firstActual, firstActual + 3)).toEqual([null, null, null])
    expect(first.slice(secondActual, secondActual + 3)).toEqual([0, 0, null])
    expect(second.slice(firstActual, firstActual + 3)).toEqual([60, 10, 20])
    expect(second.slice(secondActual, secondActual + 3)).toEqual([55, -5, -5])

    const preview = parseUnitWorkbook(sheets, 100)
    expect(preview.errors).toEqual([])
    expect(preview.warnings).toEqual([])
    expect(preview.periods).toEqual([{ id: "unit-1", name: "1单元" }, { id: "unit-2", name: "2单元" }])
    expect(preview.rows.map(({ line: _line, ...row }) => row)).toEqual([
      { number: "001", name: "学生甲", gender: "男", baseline: 50, level: "A", task: "基础巩固", scores: plan.entries[0].scores },
      { number: "002", name: "学生乙", gender: "女", baseline: 40, level: "B", task: "拓展练习", scores: plan.entries[1].scores }
    ])
    expect(unitDifference({ ...preview.rows[0], studentId: "student-a" }, preview.periods, "unit-2")).toEqual({ gap: 0, change: null })

    const restored: UnitTrackingPlan = {
      ...plan,
      periods: preview.periods,
      entries: preview.rows.map((row, index) => ({ studentId: students[index].id, baseline: row.baseline, level: row.level, task: row.task, scores: row.scores }))
    }
    await exportUnitWorkbook(restored, students, "七年级三班", "数学")
    const [nextBlob, nextName] = vi.mocked(downloadBlob).mock.lastCall!
    const next = parseUnitWorkbook(await readScoreFile(new File([nextBlob], nextName)), 100)
    expect(next).toEqual(preview)
  })

  it("导出整计划排名及相邻名次变化，回导忽略派生列重算，分数与名次单位明确区分", async () => {
    vi.mocked(downloadBlob).mockClear()
    const ids = ["a", "b", "c", "d"]
    const students: Student[] = [
      ...ids.map((id, index) => ({ id, number: `00${index + 1}`, name: "同名学生", classId: "one", focus: false, note: "" })),
      { id: "other", number: "001", name: "同名学生", classId: "two", focus: false, note: "其他班级" }
    ]
    const plan: UnitTrackingPlan = {
      id: "plan",
      name: "排名跟踪",
      classId: "one",
      subjectId: "math",
      periods: [{ id: "unit-1", name: "第1单元" }, { id: "unit-2", name: "第2单元" }, { id: "unit-3", name: "第3单元" }],
      entries: ids.map((studentId, index) => ({
        studentId,
        baseline: [90, 90, 0, null][index],
        level: "A",
        task: `任务${studentId}`,
        scores: {
          "unit-1": { target: 80, actual: [80, 80, 0, null][index] },
          "unit-2": { target: 80, actual: [70, 90, null, 0][index] },
          "unit-3": { target: 80, actual: [80, null, 0, 0][index] }
        }
      }))
    }
    const before = JSON.stringify(plan)
    await exportUnitWorkbook(plan, students, "一班", "数学")
    expect(JSON.stringify(plan)).toBe(before)
    const [blob, fileName] = vi.mocked(downloadBlob).mock.lastCall!
    const sheets = await readScoreFile(new File([blob], fileName))
    const [headers, ...rows] = sheets[0].matrix
    const column = (name: string) => rows.map(row => row[headers.indexOf(name)])
    expect(rows).toHaveLength(4)
    expect(new Set(headers).size).toBe(headers.length)
    expect(column("学情调研排名")).toEqual([1, 1, 3, null])
    expect(column("1单元班级排名")).toEqual([1, 1, 3, null])
    expect(column("1单元排名变化（名）")).toEqual([0, 0, 0, null])
    expect(column("2单元班级排名")).toEqual([2, 1, null, 3])
    expect(column("2单元排名变化（名）")).toEqual([-1, 0, null, null])
    expect(column("3单元班级排名")).toEqual([1, null, 2, 2])
    expect(column("3单元排名变化（名）")).toEqual([1, null, null, 1])
    expect(column("2单元分数变化（分）")).toEqual([-10, 10, null, null])
    expect(column("2单元超目标（分）")).toEqual([-10, 10, null, -80])

    for (const row of rows) {
      headers.forEach((header, index) => {
        if (/排名|分数变化|超目标/.test(String(header))) row[index] = 999
      })
    }
    const preview = parseUnitWorkbook(sheets, 100)
    expect(preview.errors).toEqual([])
    const restored: UnitTrackingPlan = {
      ...plan,
      periods: preview.periods,
      entries: preview.rows.map(row => ({ studentId: students.find(student => student.classId === plan.classId && student.number === row.number)!.id, baseline: row.baseline, level: row.level, task: row.task, scores: row.scores }))
    }
    expect(restored.entries).toEqual(plan.entries)
    expect([...unitBaselineRanks(restored)]).toEqual([...unitBaselineRanks(plan)])
    for (const period of restored.periods) expect([...unitRankings(restored, period.id)]).toEqual([...unitRankings(plan, period.id)])
  })
})
