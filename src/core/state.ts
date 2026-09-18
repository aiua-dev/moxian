import { compareChapter } from './ids.js';
import type { Chapter } from './store.js';

/** 截至某一章之前，世界累积成什么样。递料与人物查询共用这一份投影。 */
export interface ProjectedState {
  /** 人物编号 -> 设定编号 -> 当前认知状态 */
  knowledge: Map<string, Map<string, string>>;
  /** 规范化的人物对 -> 当前关系 */
  relations: Map<string, { 甲: string; 乙: string; 变为: string }>;
  /** 事件编号 -> 发生在哪一章 */
  happenedBefore: Map<string, string>;
}

export function relationKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

export function projectState(chapters: readonly Chapter[], before: string): ProjectedState {
  const knowledge = new Map<string, Map<string, string>>();
  const relations = new Map<string, { 甲: string; 乙: string; 变为: string }>();
  const happenedBefore = new Map<string, string>();

  for (const chapter of chapters) {
    if (compareChapter(chapter.chapter, before) >= 0) continue;

    for (const id of chapter.meta.事件) happenedBefore.set(id, chapter.chapter);

    for (const item of chapter.meta.认知) {
      const bucket = knowledge.get(item.人物) ?? new Map<string, string>();
      bucket.set(item.设定, item.变为);
      knowledge.set(item.人物, bucket);
    }

    for (const item of chapter.meta.关系) {
      relations.set(relationKey(item.甲, item.乙), {
        甲: item.甲,
        乙: item.乙,
        变为: item.变为,
      });
    }
  }

  return { knowledge, relations, happenedBefore };
}
