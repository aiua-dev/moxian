/** 供别的程序当库用。CLI 之外的能力都在这里导出。 */
export { TOOL, KINDS, type Kind } from './constants.js';
export * from './domain/schema.js';
export { MoxianError } from './core/errors.js';
export {
  compareChapter,
  normalizeChapter,
  normalizeEntryId,
  splitChapter,
} from './core/ids.js';
export { findProjectRoot, loadProject, type Project } from './core/project.js';
export {
  listChapters,
  listOutlines,
  readAllChapters,
  readChapter,
  readEntries,
  type Chapter,
  type Outline,
} from './core/store.js';
export { renderPack } from './core/pack.js';
export { projectState } from './core/state.js';
export { validateDataset, type Dataset } from './core/validate.js';
export { type Diagnostic, type Severity } from './core/diagnostics.js';
