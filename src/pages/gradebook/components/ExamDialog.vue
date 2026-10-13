<script lang="ts" setup>
import { useGradebookStore } from "@/pinia/stores/gradebook"
import { validateSubjects } from "../validation"

const visible = defineModel<boolean>({ required: true })
const store = useGradebookStore()
const name = ref("")
const date = ref(new Date().toLocaleDateString("sv-SE"))
function save() {
  if (!name.value.trim() || !date.value) return ElMessage.error("请填写考试名称和日期")
  const error = validateSubjects(store.workspace.subjects)
  if (error) return ElMessage.error(error)
  const id = crypto.randomUUID()
  store.workspace.exams.push({ id, name: name.value.trim(), date: date.value, subjects: JSON.parse(JSON.stringify(store.workspace.subjects)) })
  store.workspace.selectedExamId = id
  visible.value = false
  name.value = ""
  ElMessage.success("考试已创建，学科分数线已独立保存")
}
</script>

<template>
  <el-dialog v-model="visible" title="新建考试" width="460px">
    <el-form label-position="top">
      <el-form-item label="考试名称（必填）">
        <el-input v-model="name" placeholder="例如：期中考试" maxlength="40" />
      </el-form-item><el-form-item label="考试日期（必填）">
        <el-date-picker v-model="date" type="date" value-format="YYYY-MM-DD" />
      </el-form-item>
    </el-form>
    <p class="hint">
      本次考试使用当前设置的 {{ store.workspace.subjects.length }} 门学科与分数线。之后修改学科设置仅影响新建考试，历史成绩保持原有口径。
    </p>
    <template #footer>
      <el-button @click="visible = false">
        取消
      </el-button><el-button type="primary" @click="save">
        创建考试
      </el-button>
    </template>
  </el-dialog>
</template>
