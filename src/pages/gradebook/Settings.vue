<script lang="ts" setup>
import type { Subject } from "./types"
import { CacheKey } from "@@/constants/cache-key"
import { Download, Plus, Upload } from "@element-plus/icons-vue"
import { useGradebookStore } from "@/pinia/stores/gradebook"
import ExamDialog from "./components/ExamDialog.vue"
import { downloadBlob } from "./files"
import { parseArchive, validateSubjects } from "./validation"

defineOptions({ name: "GradebookSettings" })
const store = useGradebookStore()
const name = ref("")
const teacher = ref("")
const threshold = ref(5)
const subjects = ref<Subject[]>([])
const classes = ref<{ id: string, name: string }[]>([])
const newClass = ref("")
const newWorkspaceVisible = ref(false)
const newName = ref("")
const newTeacher = ref("")
const examVisible = ref(false)
const restoreInput = useTemplateRef<HTMLInputElement>("restoreInput")
watch(() => store.workspace.id, () => {
  name.value = store.workspace.name
  teacher.value = store.workspace.teacher
  threshold.value = store.workspace.warningThreshold
  subjects.value = JSON.parse(JSON.stringify(store.workspace.subjects))
  classes.value = store.workspace.classes.map(item => ({ ...item }))
}, { immediate: true })
function save() {
  const error = validateSubjects(subjects.value)
  if (error) return ElMessage.error(error)
  if (!name.value.trim()) return ElMessage.error("档案名称不能为空")
  if (!Number.isInteger(threshold.value) || threshold.value < 1) return ElMessage.error("预警阈值须为正整数")
  if (classes.value.some(item => !item.name.trim()) || new Set(classes.value.map(item => item.name.trim())).size !== classes.value.length) return ElMessage.error("班级名称不能为空或重复")
  Object.assign(store.workspace, { name: name.value.trim(), teacher: teacher.value.trim(), warningThreshold: threshold.value, subjects: subjects.value.map(item => ({ ...item, name: item.name.trim() })), classes: classes.value.map(item => ({ ...item, name: item.name.trim() })) })
  ElMessage.success("设置已保存；学科设置用于之后的新考试")
}
function addClass() {
  const value = newClass.value.trim()
  if (!value || store.workspace.classes.some(item => item.name === value)) return ElMessage.error("请输入一个未使用的班级名")
  const group = { id: crypto.randomUUID(), name: value }
  store.workspace.classes.push(group)
  classes.value.push({ ...group })
  store.workspace.selectedClassId = group.id
  newClass.value = ""
  ElMessage.success("班级已创建")
}
function createProfile() {
  if (!newName.value.trim()) return ElMessage.error("档案名称不能为空")
  store.addWorkspace(newName.value, newTeacher.value)
  newWorkspaceVisible.value = false
  newName.value = ""
  newTeacher.value = ""
  ElMessage.success("已创建独立的空白教学档案")
}
function addSubject() {
  subjects.value.push({ id: crypto.randomUUID(), name: "", max: 100, pass: 60, excellent: 85 })
}
function backup() {
  downloadBlob(new Blob([JSON.stringify(store.archive, null, 2)], { type: "application/json" }), `成绩分析平台-全部档案备份-${new Date().toLocaleDateString("sv-SE")}.json`)
}
function rawBackup() {
  try {
    downloadBlob(new Blob([localStorage.getItem(CacheKey.GRADEBOOK_DATA) ?? ""], { type: "application/json" }), "成绩分析平台-原始缓存.json")
  } catch {
    ElMessage.error("无法读取浏览器缓存")
  }
}
async function restore(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    if (file.size > 15 * 1024 * 1024) throw new Error("备份文件过大，请核对文件")
    const parsed = parseArchive(JSON.parse(await file.text()))
    const count = parsed.workspaces.reduce((sum, item) => sum + item.students.length, 0)
    await ElMessageBox.confirm(`备份包含 ${parsed.workspaces.length} 个档案、${count} 位学生。恢复将替换当前全部档案；可先取消并下载当前备份。是否恢复？`, "恢复备份", { type: "warning", confirmButtonText: "恢复并替换", cancelButtonText: "取消" })
    store.restore(parsed)
    ElMessage.success("备份已恢复")
  } catch (error) {
    if (error instanceof Error) ElMessage.error(`恢复失败：${error.message}`)
  } finally {
    if (restoreInput.value) restoreInput.value.value = ""
  }
}
</script>

<template>
  <div>
    <section class="panel">
      <div class="panel-heading">
        <div><h2>我的教学档案</h2><p>同一浏览器可保存多个独立档案；切换无需登录。此功能不提供密码隔离。</p></div><el-button :icon="Plus" @click="newWorkspaceVisible = true">
          新建空白档案
        </el-button>
      </div><el-form label-position="top">
        <el-form-item label="当前档案">
          <el-select v-model="store.archive.activeWorkspaceId" aria-label="当前教学档案">
            <el-option v-for="item in store.archive.workspaces" :key="item.id" :label="item.name" :value="item.id" />
          </el-select>
        </el-form-item><div class="form-grid">
          <el-form-item label="档案名称">
            <el-input v-model="name" maxlength="40" />
          </el-form-item><el-form-item label="班主任 / 教师姓名">
            <el-input v-model="teacher" maxlength="30" />
          </el-form-item><el-form-item label="排名下降预警阈值（名）">
            <el-input-number v-model="threshold" :min="1" :max="9999" :precision="0" />
          </el-form-item>
        </div>
      </el-form>
    </section>
    <section class="panel section-gap">
      <div class="panel-heading">
        <div><h2>班级管理</h2><p>修改名称不会影响学生和历史成绩的关联</p></div>
      </div><div class="class-settings">
        <div v-for="group in classes" :key="group.id">
          <el-input v-model="group.name" maxlength="40" :aria-label="`班级名称 ${group.name}`" />
        </div><div class="new-class">
          <el-input v-model="newClass" placeholder="新班级名称" maxlength="40" aria-label="新班级名称" /><el-button :icon="Plus" @click="addClass">
            添加班级
          </el-button>
        </div>
      </div>
    </section>
    <section class="panel section-gap">
      <div class="panel-heading">
        <div><h2>学科与分数线</h2><p>保存后用于新考试。已有考试使用创建时的快照，避免改变历史统计口径。</p></div><el-button :icon="Plus" @click="addSubject">
          添加学科
        </el-button>
      </div><el-table :data="subjects">
        <el-table-column label="学科名称" min-width="140">
          <template #default="{ row }">
            <el-input v-model="row.name" maxlength="20" aria-label="学科名称" />
          </template>
        </el-table-column><el-table-column label="满分" min-width="150">
          <template #default="{ row }">
            <el-input-number v-model="row.max" :min="1" :max="10000" :precision="1" controls-position="right" aria-label="学科满分" />
          </template>
        </el-table-column><el-table-column label="及格分" min-width="150">
          <template #default="{ row }">
            <el-input-number v-model="row.pass" :min="0" :max="row.max" :precision="1" controls-position="right" aria-label="学科及格分" />
          </template>
        </el-table-column><el-table-column label="优秀分" min-width="150">
          <template #default="{ row }">
            <el-input-number v-model="row.excellent" :min="0" :max="row.max" :precision="1" controls-position="right" aria-label="学科优秀分" />
          </template>
        </el-table-column><el-table-column label="操作" width="70">
          <template #default="{ row }">
            <el-button text type="danger" :disabled="subjects.length === 1" @click="subjects = subjects.filter(item => item.id !== row.id)">
              移除
            </el-button>
          </template>
        </el-table-column>
      </el-table><p class="hint section-gap">
        分数线要求：0 ≤ 及格分 ≤ 优秀分 ≤ 满分。至少保留一门学科。
      </p><el-button type="primary" class="section-gap" @click="save">
        保存档案与班级设置
      </el-button>
    </section>
    <section class="panel section-gap">
      <div class="panel-heading">
        <div><h2>考试记录</h2><p>每次考试独立留存成绩，按日期追踪变化</p></div><el-button :icon="Plus" @click="examVisible = true">
          新建考试
        </el-button>
      </div><el-table :data="store.workspace.exams" empty-text="暂无考试">
        <el-table-column prop="name" label="考试名称" min-width="160" /><el-table-column prop="date" label="日期" width="130" /><el-table-column label="学科快照" min-width="260">
          <template #default="{ row }">
            {{ row.subjects.map((item: Subject) => `${item.name} ${item.max}分`).join(' · ') }}
          </template>
        </el-table-column><el-table-column label="操作" width="110">
          <template #default="{ row }">
            <router-link to="/scores" @click="store.workspace.selectedExamId = row.id">
              <el-button text type="primary">
                查看 / 录入
              </el-button>
            </router-link>
          </template>
        </el-table-column>
      </el-table>
    </section>
    <section class="panel section-gap">
      <div class="panel-heading">
        <div><h2>备份与恢复</h2><p>备份包含全部本地档案、学生、考试、成绩与设置</p></div>
      </div><p class="hint">
        正常模式下关闭浏览器后数据仍会保留。浏览器清理网站数据、隐私模式、换设备或换网址不会自动迁移数据；请下载 JSON 备份，需要时在新浏览器恢复。备份内含学生成绩，请妥善保存。
      </p><div class="toolbar-group section-gap">
        <el-button type="primary" :icon="Download" @click="backup">
          下载全部档案备份
        </el-button><el-button :icon="Upload" @click="restoreInput?.click()">
          从 JSON 恢复
        </el-button><el-button v-if="store.loadError" @click="rawBackup">
          下载无法读取的原始缓存
        </el-button>
      </div><input ref="restoreInput" type="file" accept=".json" hidden @change="restore">
    </section>
    <el-dialog v-model="newWorkspaceVisible" title="新建我的教学档案" width="460px">
      <el-form label-position="top">
        <el-form-item label="档案名称（必填）">
          <el-input v-model="newName" placeholder="例如：2026 学年八年级" maxlength="40" />
        </el-form-item><el-form-item label="教师姓名">
          <el-input v-model="newTeacher" maxlength="30" />
        </el-form-item>
      </el-form><p class="hint">
        新档案为空白，与已有档案独立保存；创建后可设置班级并导入成绩。
      </p><template #footer>
        <el-button @click="newWorkspaceVisible = false">
          取消
        </el-button><el-button type="primary" @click="createProfile">
          创建空白档案
        </el-button>
      </template>
    </el-dialog><ExamDialog v-model="examVisible" />
  </div>
</template>

<style scoped>
.class-settings {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 14px;
}
.new-class {
  display: flex;
  gap: 10px;
}
</style>
