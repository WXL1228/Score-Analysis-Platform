<script lang="ts" setup>
import type { Exam } from "../types"
import { useGradebookStore } from "@/pinia/stores/gradebook"
import { createId } from "../id"
import { validateSubjects } from "../validation"

const { exam } = defineProps<{ exam?: Exam }>()
const visible = defineModel<boolean>({ required: true })
const store = useGradebookStore()
const name = ref("")
const date = ref(new Date().toLocaleDateString("sv-SE"))
let workspaceId = ""
let editingId = ""
watch(visible, (value) => {
  if (!value) return
  workspaceId = store.workspace.id
  editingId = exam?.id ?? ""
  name.value = exam?.name ?? ""
  date.value = exam?.date ?? new Date().toLocaleDateString("sv-SE")
})
function save() {
  if (workspaceId !== store.workspace.id) return ElMessage.error("档案已切换，请重新打开考试窗口")
  if (!name.value.trim() || !date.value) return ElMessage.error("请填写考试名称和日期")
  if (editingId) {
    if (!store.workspace.exams.some(item => item.id === editingId)) return ElMessage.error("考试已不存在，请重新打开窗口")
    store.workspace.exams = store.workspace.exams.map(item => item.id === editingId ? { ...item, name: name.value.trim(), date: date.value } : item)
    visible.value = false
    ElMessage.success("考试信息已保存")
    return
  }
  const error = validateSubjects(store.workspace.subjects)
  if (error) return ElMessage.error(error)
  const id = createId()
  store.workspace.exams.push({ id, name: name.value.trim(), date: date.value, subjects: JSON.parse(JSON.stringify(store.workspace.subjects)) })
  store.workspace.selectedExamId = id
  visible.value = false
  name.value = ""
  ElMessage.success("考试已创建，学科分数线已独立保存")
}
</script>

<template>
  <el-dialog v-model="visible" :title="exam ? '编辑考试' : '新建考试'" width="460px">
    <el-form label-position="top">
      <el-form-item label="考试名称（必填）">
        <el-input v-model="name" placeholder="例如：期中考试" maxlength="40" aria-label="考试名称" />
      </el-form-item><el-form-item label="考试日期（必填）">
        <el-date-picker v-model="date" type="date" value-format="YYYY-MM-DD" aria-label="考试日期" />
      </el-form-item>
    </el-form>
    <p v-if="exam" class="hint">
      编辑考试名称和日期，已录入的学生成绩及本次考试的学科与分数线快照保留。
    </p><p v-else class="hint">
      本次考试使用当前设置的 {{ store.workspace.subjects.length }} 门学科与分数线。之后修改学科设置仅影响新建考试，历史成绩保持原有口径。
    </p>
    <template #footer>
      <el-button @click="visible = false">
        取消
      </el-button><el-button type="primary" @click="save">
        {{ exam ? '保存考试' : '创建考试' }}
      </el-button>
    </template>
  </el-dialog>
</template>
