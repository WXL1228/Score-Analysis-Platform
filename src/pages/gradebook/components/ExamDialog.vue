<script lang="ts" setup>
import type { Exam, Subject } from "../types"
import { Plus } from "@element-plus/icons-vue"
import { useGradebookStore } from "@/pinia/stores/gradebook"
import { createId } from "../id"
import { validateSubjects } from "../validation"

const { exam } = defineProps<{ exam?: Exam }>()
const visible = defineModel<boolean>({ required: true })
const store = useGradebookStore()
const name = ref("")
const date = ref(new Date().toLocaleDateString("sv-SE"))
const subjects = ref<Subject[]>([])
const isSaving = ref(false)
let workspaceId = ""
let editingId = ""
let session = 0
const selectedSubjects = computed({
  get: () => store.workspace.subjects.filter(configured => subjects.value.some(subject => subject.id === configured.id || subject.name.trim() === configured.name.trim())).map(subject => subject.id),
  set: (ids: string[]) => {
    const selected = new Set(ids)
    const configured = store.workspace.subjects
    const next = subjects.value.filter(subject => !configured.some(item => item.id === subject.id || item.name.trim() === subject.name.trim()) || configured.some(item => selected.has(item.id) && (item.id === subject.id || item.name.trim() === subject.name.trim())))
    for (const subject of configured.filter(subject => selected.has(subject.id))) {
      if (!next.some(item => item.id === subject.id || item.name.trim() === subject.name.trim())) {
        const original = exam?.subjects.find(item => item.id === subject.id) ?? exam?.subjects.find(item => item.name.trim() === subject.name.trim())
        next.push({ ...(original ?? subject) })
      }
    }
    if (next.length !== subjects.value.length || next.some((subject, index) => subject !== subjects.value[index])) subjects.value = next
  }
})
watch(visible, (value) => {
  session++
  if (!value) return
  workspaceId = store.workspace.id
  editingId = exam?.id ?? ""
  name.value = exam?.name ?? ""
  date.value = exam?.date ?? new Date().toLocaleDateString("sv-SE")
  subjects.value = (exam?.subjects ?? store.workspace.subjects).map(subject => ({ ...subject }))
}, { immediate: true })
function addSubject() {
  subjects.value.push({ id: createId(), name: "", max: 100, pass: 60, excellent: 85 })
}
async function save() {
  if (isSaving.value) return
  if (workspaceId !== store.workspace.id) return ElMessage.error("档案已切换，请重新打开考试窗口")
  if (!name.value.trim() || !date.value) return ElMessage.error("请填写考试名称和日期")
  const current = store.workspace.exams.find(item => item.id === editingId)
  if (editingId && !current) return ElMessage.error("考试已不存在，请重新打开窗口")
  const entered = subjects.value.map(subject => ({ ...subject, name: subject.name.trim() }))
  const preserved = entered.map((subject) => {
    if (current?.subjects.some(item => item.id === subject.id)) return subject
    const original = current?.subjects.find(item => item.name.trim() === subject.name && !entered.some(other => other.id === item.id))
    return { ...subject, id: original?.id ?? subject.id }
  })
  const error = validateSubjects(preserved)
  if (error) return ElMessage.error(error)
  const input: Exam = { id: editingId || createId(), name: name.value.trim(), date: date.value, subjects: preserved }
  const removed = current?.subjects.filter(subject => !input.subjects.some(item => item.id === subject.id)).flatMap((subject) => {
    const records = store.workspace.records.filter(record => record.examId === editingId && typeof record.scores[subject.id] === "number")
    if (!records.length) return []
    const counts = store.workspace.classes.map((group) => {
      const students = new Set(store.workspace.students.filter(student => student.classId === group.id).map(student => student.id))
      return { name: group.name, count: records.filter(record => students.has(record.studentId)).length }
    }).filter(group => group.count)
    return [`${subject.name}：${records.length} 条（${counts.map(group => `${group.name} ${group.count} 条`).join("、")}）`]
  }) ?? []
  const savingSession = session
  isSaving.value = true
  try {
    if (removed.length) {
      await ElMessageBox.confirm(`保存将移除以下学科，并删除本次考试各班已录入的对应成绩（包含 0 分）：${removed.join("；")}。其他考试不受影响。是否继续？`, "确认移除考试学科", { type: "warning", confirmButtonText: "保存并移除成绩", cancelButtonText: "返回编辑" })
    }
    if (workspaceId !== store.workspace.id || session !== savingSession || !visible.value) return ElMessage.error("档案或编辑窗口已变化，请重新打开考试窗口")
    if (editingId && !store.workspace.exams.some(item => item.id === editingId)) return ElMessage.error("考试已不存在，请重新打开窗口")
    store.upsertExam(input)
    visible.value = false
    ElMessage.success(editingId ? "考试及本次学科设置已保存" : "考试已创建，使用本次学科与分数线设置")
  } catch (error) {
    if (error !== "cancel" && error !== "close") ElMessage.error((error as Error).message)
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <el-dialog v-model="visible" :title="exam ? '编辑考试' : '新建考试'" width="900px" :close-on-click-modal="!isSaving" :close-on-press-escape="!isSaving" :show-close="!isSaving">
    <el-form label-position="top" :disabled="isSaving">
      <div class="form-grid">
        <el-form-item label="考试名称（必填）">
          <el-input v-model="name" placeholder="例如：期中考试" maxlength="40" aria-label="考试名称" />
        </el-form-item><el-form-item label="考试日期（必填）">
          <el-date-picker v-model="date" type="date" value-format="YYYY-MM-DD" aria-label="考试日期" />
        </el-form-item>
      </div>
      <el-form-item v-if="store.workspace.subjects.length" label="从档案选择学科">
        <el-select v-model="selectedSubjects" multiple placeholder="选择本次考试学科，也可手动添加" aria-label="从档案选择考试学科">
          <el-option v-for="subject in store.workspace.subjects" :key="subject.id" :label="subject.name" :value="subject.id" />
        </el-select>
      </el-form-item>
      <div class="panel-heading section-gap">
        <h2>本次考试学科与分数线</h2><el-button :icon="Plus" aria-label="添加考试学科" @click="addSubject">
          手动添加学科
        </el-button>
      </div>
      <p class="hint">
        默认复制档案学科配置；这里的调整只用于本次考试，不修改档案或其他考试。新增学科的已有学生成绩为缺考，移除学科时会删除本次考试对应的成绩。
      </p>
      <el-table :data="subjects" empty-text="请从档案选择学科，或点击“手动添加学科”" aria-label="本次考试学科设置" max-height="340">
        <el-table-column label="学科名称" min-width="160">
          <template #default="{ row, $index }">
            <el-input v-model="row.name" maxlength="40" placeholder="学科名称" :aria-label="`考试学科${$index + 1}名称`" />
          </template>
        </el-table-column><el-table-column label="满分" min-width="155">
          <template #default="{ row, $index }">
            <el-input-number v-model="row.max" :min="1" :max="10000" :precision="1" controls-position="right" :aria-label="`考试学科${$index + 1}满分`" />
          </template>
        </el-table-column><el-table-column label="及格分" min-width="155">
          <template #default="{ row, $index }">
            <el-input-number v-model="row.pass" :min="0" :max="row.max" :precision="1" controls-position="right" :aria-label="`考试学科${$index + 1}及格分`" />
          </template>
        </el-table-column><el-table-column label="优秀分" min-width="155">
          <template #default="{ row, $index }">
            <el-input-number v-model="row.excellent" :min="0" :max="row.max" :precision="1" controls-position="right" :aria-label="`考试学科${$index + 1}优秀分`" />
          </template>
        </el-table-column><el-table-column label="操作" width="100" align="center">
          <template #default="{ row, $index }">
            <el-button text type="danger" :aria-label="`移除考试学科${$index + 1} ${row.name || '未命名'}`" @click="subjects = subjects.filter(subject => subject.id !== row.id)">
              移除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-form>
    <p v-if="!store.workspace.subjects.length" class="hint">
      当前档案还没有学科，可以直接手动添加本次考试学科；保存后不改变档案学科设置。
    </p>
    <template #footer>
      <el-button :disabled="isSaving" aria-label="取消考试编辑" @click="visible = false">
        取消
      </el-button><el-button type="primary" :loading="isSaving" :aria-label="exam ? '保存本次考试' : '创建本次考试'" @click="save">
        {{ exam ? '保存考试' : '创建考试' }}
      </el-button>
    </template>
  </el-dialog>
</template>
