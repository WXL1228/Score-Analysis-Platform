<script lang="ts" setup>
import { useGradebookStore } from "@/pinia/stores/gradebook"

const { studentId = "" } = defineProps<{ studentId?: string }>()
const visible = defineModel<boolean>({ required: true })
const store = useGradebookStore()
const selectedStudent = ref("")
const scores = ref<Record<string, number | undefined>>({})
const total = computed(() => store.exam ? store.exam.subjects.reduce((sum, subject) => sum + (scores.value[subject.id] ?? 0), 0) : null)
function load() {
  const record = store.workspace.records.find(item => item.studentId === selectedStudent.value && item.examId === store.workspace.selectedExamId)
  scores.value = Object.fromEntries((store.exam?.subjects ?? []).map(subject => [subject.id, record?.scores[subject.id] ?? undefined]))
}
watch(visible, (value) => {
  if (value) {
    selectedStudent.value = studentId || store.students[0]?.id || ""
    load()
  }
})
watch(selectedStudent, load)
function save() {
  if (!store.exam || !selectedStudent.value) return ElMessage.error("请选择学生和考试")
  for (const subject of store.exam.subjects) {
    const value = scores.value[subject.id]
    if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > subject.max)) return ElMessage.error(`${subject.name}分数须在 0～${subject.max} 之间`)
  }
  store.upsertScores({ examId: store.exam.id, studentId: selectedStudent.value, scores: Object.fromEntries(store.exam.subjects.map(subject => [subject.id, scores.value[subject.id] ?? null])) })
  visible.value = false
  ElMessage.success("成绩已保存，总分与排名已更新")
}
</script>

<template>
  <el-dialog v-model="visible" title="手动录入成绩" width="520px">
    <el-form label-position="top">
      <el-form-item label="学生">
        <el-select v-model="selectedStudent" filterable aria-label="录入学生">
          <el-option v-for="student in store.students" :key="student.id" :value="student.id" :label="`${student.number} · ${student.name}`" />
        </el-select>
      </el-form-item><div class="form-grid">
        <el-form-item v-for="subject in store.exam?.subjects" :key="subject.id" :label="`${subject.name}（满分 ${subject.max}）`">
          <el-input-number v-model="scores[subject.id]" :min="0" :max="subject.max" :precision="1" controls-position="right" placeholder="缺考请留空" />
        </el-form-item>
      </div>
    </el-form>
    <p class="hint">
      留空代表缺考或未录入，按 0 分计入总分和排名，平均分按全部学科计算。总分：{{ total ?? '请选择考试' }}{{ total === null ? '' : `，平均分：${(total / (store.exam?.subjects.length || 1)).toFixed(1)}` }}
    </p>
    <template #footer>
      <el-button @click="visible = false">
        取消
      </el-button><el-button type="primary" @click="save">
        保存成绩
      </el-button>
    </template>
  </el-dialog>
</template>
