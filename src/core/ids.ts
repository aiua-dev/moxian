import { KIND_PREFIX, type Kind } from '../constants.js';
import { MoxianError } from './errors.js';

export { MoxianError };

const CHAPTER_RE = /^(\d+)-(\d+)$/;

/**
 * 章号规范化：接受 1-3 / 1-03 / 1-003，统一成 1-03。
 * 章号是全书的主键，必须唯一且人能读，所以只允许 卷-章 这一种形状。
 */
export function normalizeChapter(input: string): string {
  const trimmed = input.trim().replace(/[－—–]/g, '-');
  const match = CHAPTER_RE.exec(trimmed);
  if (!match) {
    throw new MoxianError(`章号格式不对：「${input}」。正确形状是 卷-章，例如 1-03。`);
  }
  const volume = Number.parseInt(match[1]!, 10);
  const chapter = Number.parseInt(match[2]!, 10);
  if (volume < 1 || chapter < 1) {
    throw new MoxianError(`章号的卷与章都必须大于 0：「${input}」。`);
  }
  return `${volume}-${String(chapter).padStart(2, '0')}`;
}

/** 章号拆成卷与章两个数字，用于排序。 */
export function splitChapter(chapter: string): { volume: number; index: number } {
  const normalized = normalizeChapter(chapter);
  const [volume, index] = normalized.split('-');
  return { volume: Number.parseInt(volume!, 10), index: Number.parseInt(index!, 10) };
}

/** 写作序比较：先比卷，再比章。 */
export function compareChapter(a: string, b: string): number {
  const left = splitChapter(a);
  const right = splitChapter(b);
  if (left.volume !== right.volume) return left.volume - right.volume;
  return left.index - right.index;
}

/**
 * 条目编号规范化：接受 f-1 / F1 / f-001，统一成 F-001。
 * 前缀必须和类型匹配，否则是作者写错了类型。
 */
export function normalizeEntryId(input: string, kind: Kind): string {
  const expected = KIND_PREFIX[kind];
  const trimmed = input.trim().toUpperCase().replace(/[\s_]/g, '');
  const match = /^([A-Z]+)-?(\d+)$/.exec(trimmed);
  if (!match) {
    throw new MoxianError(`编号格式不对：「${input}」。正确形状是 ${expected}-001。`);
  }
  const prefix = match[1]!;
  if (prefix !== expected) {
    throw new MoxianError(`「${input}」不属于${kind}类。${kind}类编号应以 ${expected}- 开头。`);
  }
  const serial = Number.parseInt(match[2]!, 10);
  if (serial < 1) throw new MoxianError(`编号序号必须大于 0：「${input}」。`);
  return `${expected}-${String(serial).padStart(3, '0')}`;
}

/** 按前缀推断编号属于哪一类。 */
export function kindOfEntryId(id: string): Kind | null {
  const prefix = id.split('-')[0];
  for (const [kind, value] of Object.entries(KIND_PREFIX)) {
    if (value === prefix) return kind as Kind;
  }
  return null;
}

/** 分配下一个可用编号。取现有最大序号加一，不复用空洞，避免历史引用错位。 */
export function allocateEntryId(kind: Kind, existingIds: readonly string[]): string {
  const prefix = KIND_PREFIX[kind];
  let max = 0;
  for (const id of existingIds) {
    const match = /^([A-Z]+)-(\d+)$/.exec(id);
    if (!match || match[1] !== prefix) continue;
    const serial = Number.parseInt(match[2]!, 10);
    if (serial > max) max = serial;
  }
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

/** 体积用 卷-章 主键推导文件名：1-03-雪夜归人.md。 */
export function chapterFileName(chapter: string, title: string): string {
  const safe = title.replace(/[\\/:*?"<>|\n\r]/g, '').trim();
  return `${normalizeChapter(chapter)}-${safe}.md`;
}

/** 从文件名还原章号，解析失败返回 null（非正文或已损坏的文件）。 */
export function chapterFromFileName(fileName: string): string | null {
  const match = /^(\d+-\d+)-.+\.md$/.exec(fileName);
  if (!match) return null;
  try {
    return normalizeChapter(match[1]!);
  } catch {
    return null;
  }
}

/** 从文件名还原标题。 */
export function titleFromFileName(fileName: string): string | null {
  const match = /^(\d+-\d+)-(.+)\.md$/.exec(fileName);
  return match ? match[2]! : null;
}
