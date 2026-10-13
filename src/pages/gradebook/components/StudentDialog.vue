<script lang="ts" setup>
import type { Student } from "../types"
import { useGradebookStore } from "@/pinia/stores/gradebook"

const { student } = defineProps<{ student?: Student }>()
const visible = defineModel<boolean>({ required: true })
const store = useGradebookStore()
const form = ref<Student>({ id: "", number: "", name: "", classId: "", focus: false, note: "" })
watch(visible, (value) => {
  if (value) form.value = student ? { ...student } : { id: crypto.randomUUID(), number: "", name: "", classId: store.schoolClass.id, focus: false, note: "" }
})
function save() {
  if (!form.value.number.trim() || !form.value.name.trim()) return ElMessage.error("学号和姓名不能为空")
  try {
    store.upsertStudent({ ...form.value, number: form.value.number.trim(), name: form.value.name.trim() })
    visible.value = false
    ElMessage.success("学生信息已保存")
  } catch (error) {
    ElMessage.error((error as Error).message)
  }
}
</script>

<template>
  <el-dialog v-model="visible" :title="student ? '编辑学生' : '添加学生'" width="480px">
    <el-form label-position="top">
      <div class="form-grid">
        <el-form-item label="学号（必填）">
          <el-input v-model="form.number" maxlength="40" placeholder="保留前导零，如 001" />
        </el-form-item><el-form-item label="姓名（必填）">
          <el-input v-model="form.name" maxlength="30" />
        </el-form-item>
      </div><el-form-item label="班级">
        <el-input :model-value="store.workspace.classes.find(item => item.id === form.classId)?.name" disabled />
      </el-form-item><el-form-item label="重点关注">
        <el-switch v-model="form.focus" />
      </el-form-item><el-form-item label="教师备注">
        <el-input v-model="form.note" type="textarea" :rows="3" maxlength="300" show-word-limit placeholder="记录学习情况或支持计划" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">
        取消
      </el-button><el-button type="primary" @click="save">
        保存学生
      </el-button>
    </template>
  </el-dialog>
</template>
