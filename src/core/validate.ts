import * as path from 'node:path';
import { DANGLING_THRESHOLD, DIR_CONTINUITY, PROJECT_FILE, type Kind } from '../constants.js';
import type { Foreshadow, Person, Setting, TimelineEvent } from '../domain/schema.js';
import { RULES, WARNINGS, hardError, warning, type Diagnostic } from './diagnostics.js';
import { compareChapter, kindOfEntryId, normalizeChapter, splitChapter } from './ids.js';
import { findVolume, type Project } from './project.js';
import type { Chapter, Outline } from './store.js';

export interface Dataset {
  project: Project;
  chapters: Chapter[];
  entries: {
    伏笔: Foreshadow[];
    人物: Person[];
    时间线: TimelineEvent[];
    设定: Setting[];
  };
  outlines: Outline[];
}

function rel(project: Project, file: string): string {
  return path.relative(project.root, file) || file;
}

/** 诊断排序：硬错在前，再按规则号，最后按位置。让输出稳定可读。 */
export function sortDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  const weight = (item: Diagnostic): number => (item.severity === '硬错' ? 0 : 1);
  return [...diagnostics].sort((a, b) => {
    if (weight(a) !== weight(b)) return weight(a) - weight(b);
    if (a.rule !== b.rule) return a.rule.localeCompare(b.rule);
    return (a.where ?? '').localeCompare(b.where ?? '');
  });
}

/**
 * 全量校验。硬错 = 结构上不成立；提醒 = 内容上可疑但可能是作者有意为之。
 * 内容层面的语义判断（设定是否被违反、口吻是否漂移）不在这里，那是 agent 的活。
 */
export function validateDataset(data: Dataset): Diagnostic[] {
  const out: Diagnostic[] = [];
  const { project, chapters, entries, outlines } = data;

  /* ---------------------------- 章索引 ---------------------------- */
  const chapterByNumber = new Map<string, Chapter>();
  for (const chapter of chapters) {
    const where = rel(project, chapter.file);
    if (chapter.meta.章 !== chapter.chapter) {
      out.push(
        hardError(
          RULES.CHAPTER_SHAPE,
          `文件名里的章号是 ${chapter.chapter}，frontmatter 里写的是 ${chapter.meta.章}，两边必须一致。`,
          where,
        ),
      );
    }
    const existing = chapterByNumber.get(chapter.chapter);
    if (existing) {
      out.push(
        hardError(
          RULES.CHAPTER_NUMBER_TAKEN,
          `第 ${chapter.chapter} 章有两个文件：${rel(project, existing.file)} 与 ${where}。`,
          where,
        ),
      );
      continue;
    }
    chapterByNumber.set(chapter.chapter, chapter);
  }

  const chapterNumbers = [...chapterByNumber.keys()].sort(compareChapter);
  const orderIndex = new Map<string, number>();
  chapterNumbers.forEach((number, index) => orderIndex.set(number, index));
  const lastChapter = chapterNumbers.at(-1) ?? null;

  /* ---------------------------- 条目索引 ---------------------------- */
  const index: Record<Kind, Map<string, unknown>> = {
    伏笔: new Map(),
    人物: new Map(),
    时间线: new Map(),
    设定: new Map(),
  };

  const kindLists: { kind: Kind; list: { 编号: string }[] }[] = [
    { kind: '伏笔', list: entries.伏笔 },
    { kind: '人物', list: entries.人物 },
    { kind: '时间线', list: entries.时间线 },
    { kind: '设定', list: entries.设定 },
  ];

  for (const { kind, list } of kindLists) {
    const where = `${DIR_CONTINUITY}/${kind}.yaml`;
    for (const entry of list) {
      const actual = kindOfEntryId(entry.编号);
      if (actual !== kind) {
        out.push(
          hardError(
            RULES.KIND_MISMATCH,
            `${kind}.yaml 里出现了 ${entry.编号}，这个编号属于${actual ?? '未知'}类。`,
            where,
          ),
        );
        continue;
      }
      if (index[kind].has(entry.编号)) {
        out.push(hardError(RULES.ID_DUPLICATED, `${kind} ${entry.编号} 重复登记了。`, where));
        continue;
      }
      index[kind].set(entry.编号, entry);
    }
  }

  const refersEntry = (id: string, expected: Kind | null, where: string, owner: string): void => {
    const actual = kindOfEntryId(id);
    if (expected !== null && actual !== expected) {
      out.push(
        hardError(RULES.REF_MISSING, `${owner} 引用的是 ${id}，但这不是${expected}类的编号。`, where),
      );
      return;
    }
    if (actual === null) {
      out.push(hardError(RULES.REF_MISSING, `${owner} 引用的 ${id} 不是合法编号。`, where));
      return;
    }
    if (!index[actual].has(id)) {
      out.push(
        hardError(RULES.REF_MISSING, `${owner} 引用的 ${id} 不存在。先把这条登记出来。`, where),
      );
    }
  };

  const refersChapter = (chapterNo: string, where: string, owner: string): void => {
    let normalized: string;
    try {
      normalized = normalizeChapter(chapterNo);
    } catch {
      out.push(hardError(RULES.CHAPTER_SHAPE, `${owner} 的章号「${chapterNo}」格式不对。`, where));
      return;
    }
    if (!chapterByNumber.has(normalized)) {
      out.push(
        hardError(RULES.REF_MISSING, `${owner} 指向第 ${normalized} 章，但正文里没有这一章。`, where),
      );
    }
  };

  /* ---------------------------- 卷登记 ---------------------------- */
  for (const chapter of chapters) {
    const volume = splitChapter(chapter.chapter).volume;
    if (!findVolume(project, volume)) {
      out.push(
        hardError(
          RULES.UNKNOWN_VOLUME,
          `第 ${chapter.chapter} 章属于第 ${volume} 卷，但 ${PROJECT_FILE} 里没有登记这一卷。`,
          rel(project, chapter.file),
        ),
      );
    }
  }
  for (const outline of outlines) {
    if (!findVolume(project, outline.volume)) {
      out.push(
        hardError(
          RULES.UNKNOWN_VOLUME,
          `卷大纲写的是第 ${outline.volume} 卷，但 ${PROJECT_FILE} 里没有登记这一卷。`,
          rel(project, outline.file),
        ),
      );
    }
  }

  /* ---------------------------- 章节事件 ---------------------------- */
  const eventChapter = new Map<string, string>();
  for (const chapter of chapters) {
    const where = rel(project, chapter.file);
    const owner = `第 ${chapter.chapter} 章`;

    for (const id of chapter.meta.埋) refersEntry(id, '伏笔', where, `${owner} 的「埋」`);
    for (const id of chapter.meta.收) refersEntry(id, '伏笔', where, `${owner} 的「收」`);

    for (const id of chapter.meta.事件) {
      refersEntry(id, '时间线', where, `${owner} 的「事件」`);
      const previous = eventChapter.get(id);
      if (previous) {
        out.push(
          hardError(
            RULES.ID_DUPLICATED,
            `事件 ${id} 在第 ${previous} 章和第 ${chapter.chapter} 章都被声明，一个事件只能发生在一章。`,
            where,
          ),
        );
      } else {
        eventChapter.set(id, chapter.chapter);
      }
    }

    for (const item of chapter.meta.认知) {
      refersEntry(item.人物, '人物', where, `${owner} 的「认知」`);
      refersEntry(item.设定, '设定', where, `${owner} 的「认知」`);
    }
    for (const item of chapter.meta.关系) {
      refersEntry(item.甲, '人物', where, `${owner} 的「关系」`);
      refersEntry(item.乙, '人物', where, `${owner} 的「关系」`);
    }
  }

  /* ---------------------------- 伏笔自身 ---------------------------- */
  const foreshadowWhere = `${DIR_CONTINUITY}/伏笔.yaml`;
  for (const item of entries.伏笔) {
    const owner = `伏笔 ${item.编号}`;
    if (item.埋) refersChapter(item.埋, foreshadowWhere, `${owner} 的「埋」`);
    if (item.回收) refersChapter(item.回收, foreshadowWhere, `${owner} 的「回收」`);
    if (item.预期回收) refersChapter(item.预期回收, foreshadowWhere, `${owner} 的「预期回收」`);

    if (item.埋 && item.回收 && compareChapter(item.回收, item.埋) < 0) {
      out.push(
        hardError(
          RULES.ORDER_INVERTED,
          `${owner} 的回收章 ${item.回收} 早于埋设章 ${item.埋}。`,
          foreshadowWhere,
        ),
      );
    }
    if (item.状态 === '已收' && !item.回收) {
      out.push(
        hardError(RULES.STATE_CONTRADICTION, `${owner} 标为已收，却没写回收章。`, foreshadowWhere),
      );
    }
    if (item.状态 === '悬空' && item.回收) {
      out.push(
        hardError(
          RULES.STATE_CONTRADICTION,
          `${owner} 有回收章 ${item.回收}，状态却是悬空。`,
          foreshadowWhere,
        ),
      );
    }
    for (const linked of item.关联) {
      if (/^[FPES]-/.test(linked)) {
        refersEntry(linked, null, foreshadowWhere, `${owner} 的「关联」`);
      }
    }
  }

  /* ---------------------------- 两侧同步 ---------------------------- */
  // 条目文件的 埋/回收 与章节 frontmatter 的 埋/收 互为镜像。
  // 冲突（两边都有值却不一致）是硬错；只写了一边算提醒。
  const buriedAt = new Map<string, string>();
  const collectedAt = new Map<string, string>();

  for (const chapter of chapters) {
    const where = rel(project, chapter.file);
    for (const id of chapter.meta.埋) {
      const previous = buriedAt.get(id);
      if (previous) {
        out.push(
          hardError(
            RULES.ID_DUPLICATED,
            `伏笔 ${id} 在第 ${previous} 章和第 ${chapter.chapter} 章都被登记为埋设，一条伏笔只能埋一次。`,
            where,
          ),
        );
      } else {
        buriedAt.set(id, chapter.chapter);
      }
    }
    for (const id of chapter.meta.收) {
      const previous = collectedAt.get(id);
      if (previous) {
        out.push(
          hardError(
            RULES.ID_DUPLICATED,
            `伏笔 ${id} 在第 ${previous} 章和第 ${chapter.chapter} 章都被登记为回收。`,
            where,
          ),
        );
      } else {
        collectedAt.set(id, chapter.chapter);
      }
    }
  }

  for (const item of entries.伏笔) {
    const owner = `伏笔 ${item.编号}`;
    const declaredBuried = buriedAt.get(item.编号) ?? null;
    const declaredCollected = collectedAt.get(item.编号) ?? null;

    if (item.埋 && declaredBuried && item.埋 !== declaredBuried) {
      out.push(
        hardError(
          RULES.SYNC_MISMATCH,
          `${owner} 的埋设章写着 ${item.埋}，但第 ${declaredBuried} 章登记埋的是它，两边对不上。`,
          foreshadowWhere,
        ),
      );
    }
    if (item.回收 && declaredCollected && item.回收 !== declaredCollected) {
      out.push(
        hardError(
          RULES.SYNC_MISMATCH,
          `${owner} 的回收章写着 ${item.回收}，但第 ${declaredCollected} 章登记收的是它，两边对不上。`,
          foreshadowWhere,
        ),
      );
    }
    if (item.埋 && !declaredBuried) {
      out.push(
        warning(
          WARNINGS.SYNC_INCOMPLETE,
          `${owner} 写了埋设章 ${item.埋}，但那一章的 frontmatter 没登记埋它。`,
          foreshadowWhere,
        ),
      );
    }
    if (!item.埋 && declaredBuried) {
      out.push(
        warning(
          WARNINGS.SYNC_INCOMPLETE,
          `第 ${declaredBuried} 章登记埋了 ${item.编号}，但条目里没写埋设章。`,
          foreshadowWhere,
        ),
      );
    }
    if (item.回收 && !declaredCollected) {
      out.push(
        warning(
          WARNINGS.SYNC_INCOMPLETE,
          `${owner} 写了回收章 ${item.回收}，但那一章的 frontmatter 没登记收它。`,
          foreshadowWhere,
        ),
      );
    }
    if (!item.回收 && declaredCollected) {
      out.push(
        warning(
          WARNINGS.SYNC_INCOMPLETE,
          `第 ${declaredCollected} 章登记收了 ${item.编号}，但条目里没写回收章。`,
          foreshadowWhere,
        ),
      );
    }
  }

  /* ---------------------------- 时间线自身 ---------------------------- */
  const timelineWhere = `${DIR_CONTINUITY}/时间线.yaml`;
  for (const item of entries.时间线) {
    const owner = `事件 ${item.编号}`;
    const mine = eventChapter.get(item.编号) ?? null;
    for (const previous of item.前置) {
      refersEntry(previous, '时间线', timelineWhere, `${owner} 的「前置」`);
      const previousChapter = eventChapter.get(previous);
      if (mine && previousChapter && compareChapter(previousChapter, mine) > 0) {
        out.push(
          hardError(
            RULES.ORDER_INVERTED,
            `${owner} 在第 ${mine} 章，前置事件 ${previous} 却在第 ${previousChapter} 章，因果倒了。`,
            timelineWhere,
          ),
        );
      }
    }
  }

  /* ---------------------------- 设定自身 ---------------------------- */
  const settingWhere = `${DIR_CONTINUITY}/设定.yaml`;
  for (const item of entries.设定) {
    const owner = `设定 ${item.编号}`;
    if (item.生效) refersChapter(item.生效, settingWhere, `${owner} 的「生效」`);
    if (item.揭示) refersChapter(item.揭示, settingWhere, `${owner} 的「揭示」`);
  }

  /* ---------------------------- 提醒：悬空与逾期 ---------------------------- */
  for (const item of entries.伏笔) {
    if (item.状态 === '弃用') continue;
    const span =
      item.埋 && orderIndex.has(item.埋) && lastChapter !== null
        ? orderIndex.get(lastChapter)! - orderIndex.get(item.埋)!
        : null;

    if (item.状态 === '悬空' && !item.预期回收 && span !== null && span >= DANGLING_THRESHOLD) {
      out.push(
        warning(
          WARNINGS.DANGLING,
          `伏笔 ${item.编号}「${item.描述}」埋在第 ${item.埋} 章，过去 ${span} 章还没回收，也没规划回收章。`,
          foreshadowWhere,
        ),
      );
    }
    if (
      item.状态 === '悬空' &&
      item.预期回收 &&
      lastChapter !== null &&
      compareChapter(lastChapter, item.预期回收) >= 0
    ) {
      out.push(
        warning(
          WARNINGS.OVERDUE,
          `伏笔 ${item.编号} 计划在第 ${item.预期回收} 章回收，现在写到第 ${lastChapter} 章还没收。`,
          foreshadowWhere,
        ),
      );
    }
  }

  /* ---------------------------- 提醒：角色认知早于揭示 ---------------------------- */
  const personName = (id: string): string => {
    const person = index['人物'].get(id) as Person | undefined;
    return person ? `${person.名}（${id}）` : id;
  };

  for (const chapter of chapters) {
    for (const item of chapter.meta.认知) {
      if (item.变为 !== '已知' && item.变为 !== '误信') continue;
      const setting = index['设定'].get(item.设定) as Setting | undefined;
      if (!setting?.揭示) continue;
      if (compareChapter(chapter.chapter, setting.揭示) < 0) {
        out.push(
          warning(
            WARNINGS.KNOWLEDGE_EARLY,
            `第 ${chapter.chapter} 章 ${personName(item.人物)} 已经${item.变为}「${setting.描述}」，` +
              `但这条真相计划在第 ${setting.揭示} 章才揭示。倒叙里合法，确认是有意的就忽略。`,
            rel(project, chapter.file),
          ),
        );
      }
    }
  }

  /* ---------------------------- 提醒：大纲对账 ---------------------------- */
  const planned = new Set<string>();
  for (const outline of outlines) {
    for (const raw of outline.meta.规划) {
      let normalized: string;
      try {
        normalized = normalizeChapter(raw);
      } catch {
        continue;
      }
      planned.add(normalized);
      if (!chapterByNumber.has(normalized)) {
        out.push(
          warning(
            WARNINGS.OUTLINE_PLANNED_MISSING,
            `第 ${outline.volume} 卷大纲规划了第 ${normalized} 章，正文里还没有。`,
            rel(project, outline.file),
          ),
        );
      }
    }
  }
  if (planned.size > 0) {
    for (const chapter of chapters) {
      if (!planned.has(chapter.chapter)) {
        out.push(
          warning(
            WARNINGS.OUTLINE_UNPLANNED_TEXT,
            `第 ${chapter.chapter} 章有正文，但没有任何卷大纲规划它，可能是计划外新增的。`,
            rel(project, chapter.file),
          ),
        );
      }
    }
  }

  return sortDiagnostics(out);
}
