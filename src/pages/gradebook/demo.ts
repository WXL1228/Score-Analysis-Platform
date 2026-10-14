import type { Subject, Workspace } from "./types"
import { createId } from "./id"

export const DEFAULT_SUBJECTS: Subject[] = [
  { id: "chinese", name: "语文", max: 100, pass: 60, excellent: 85 },
  { id: "math", name: "数学", max: 100, pass: 60, excellent: 85 },
  { id: "english", name: "英语", max: 100, pass: 60, excellent: 85 },
  { id: "physics", name: "物理", max: 100, pass: 60, excellent: 85 },
  { id: "history", name: "历史", max: 100, pass: 60, excellent: 85 }
]

export function createWorkspace(name: string, teacher = ""): Workspace {
  return {
    id: createId(),
    name,
    teacher,
    demo: false,
    warningThreshold: 5,
    classes: [],
    subjects: structuredClone(DEFAULT_SUBJECTS),
    students: [],
    exams: [],
    records: [],
    selectedClassId: "",
    selectedExamId: ""
  }
}

export function createDemo(): Workspace {
  const data = createWorkspace("教学档案", "老师好！")
  data.demo = true
  data.classes = [{ id: "class-1", name: "八年级（1）班" }, { id: "class-2", name: "八年级（2）班" }]
  data.selectedClassId = "class-1"
  const names = ["陈星宇", "林予安", "张可欣", "王一诺", "李沐辰", "周子涵", "赵思远", "刘书瑶", "吴雨桐", "徐知行", "孙若溪", "郑明轩", "黄梓萱", "何景然", "高语宁", "许墨", "罗嘉言", "沈亦凡", "唐心悦", "梁以晨", "宋清禾", "谢宇航", "程乐知", "苏晚晴"]
  data.classes.forEach((group, classIndex) => {
    names.forEach((name, i) => data.students.push({
      id: `${group.id}-${i}`,
      number: `${classIndex + 1}${String(i + 1).padStart(2, "0")}`,
      name: classIndex ? `${name.slice(0, 1)}${names[(i + 7) % names.length].slice(1)}` : name,
      classId: group.id,
      focus: i === 16 || i === 20,
      note: ""
    }))
  })
  data.exams = [
    { id: "exam-1", name: "开学摸底考试", date: "2026-09-03", subjects: structuredClone(DEFAULT_SUBJECTS) },
    { id: "exam-2", name: "九月月考", date: "2026-09-28", subjects: structuredClone(DEFAULT_SUBJECTS) },
    { id: "exam-3", name: "十月阶段测评", date: "2026-10-12", subjects: structuredClone(DEFAULT_SUBJECTS) }
  ]
  data.selectedExamId = "exam-3"
  data.exams.forEach((exam, e) => {
    data.students.forEach((student, i) => {
      const scores: Record<string, number> = {}
      exam.subjects.forEach((subject, s) => {
        const base = 94 - (i % 24) * 1.55
        const variation = ((i * 13 + s * 7 + e * 11) % 23) - 11
        const movement = e === 2 && i % 24 === 16 ? -17 : e === 2 && i % 24 === 9 ? 16 : e * 1.5
        scores[subject.id] = Math.round(Math.min(100, Math.max(25, base + variation + movement - (s === 1 ? 6 : 0))))
      })
      data.records.push({ examId: exam.id, studentId: student.id, scores })
    })
  })
  return data
}
