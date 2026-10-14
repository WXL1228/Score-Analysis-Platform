// 统一处理 localStorage

import type { GradebookArchive } from "@/pages/gradebook/types"
import { CacheKey } from "@@/constants/cache-key"

export function getGradebookData(): unknown {
  const json = localStorage.getItem(CacheKey.GRADEBOOK_DATA)
  return json ? JSON.parse(json) : null
}

export function setGradebookData(data: GradebookArchive) {
  localStorage.setItem(CacheKey.GRADEBOOK_DATA, JSON.stringify(data))
}
