import type { Person } from '../domain/schema.js';
import { compareChapter, splitChapter } from './ids.js';
import { projectState } from './state.js';
import type { Chapter } from './store.js';
import type { Dataset } from './validate.js';

/**
 * 按章递料。写第 N 章时，agent 需要的全部信息在这里，不多不少。
 * 刻意不塞全书正文：长篇会撑爆上下文窗口，也会把注意力稀释掉。
 */
export function renderPack(dataset: Dataset, target: string, recentCount = 3): string {
  const { project, chapters, entries, outlines } = dataset;
  const personById = new Map<string, Person>(entries.人物.map((item) => [item.编号, item]));
  const settingById = new Map(entries.设定.map((item) => [item.编号, item]));
  const eventById = new Map(entries.时间线.map((item) => [item.编号, item]));

  const personLabel = (id: string): string => {
    const person = personById.get(id);
    return person ? `${person.名}（${id}）` : id;
  };

  /* 进入这一章之前，世界已经累积成什么样。 */
  const { knowledge, relations, happenedBefore } = projectState(chapters, target);

  const targetChapter = chapters.find((item) => item.chapter === target) ?? null;
  const volume = splitChapter(target).volume;
  const outline = outlines.find((item) => item.volume === volume) ?? null;
  const volumeName = project.work.卷.find((item) => item.序号 === volume)?.名 ?? `${volume}`;

  const lines: string[] = [];
  lines.push(`# 写第 ${target} 章所需的上下文`);
  lines.push('');
  lines.push(`作品：《${project.work.书名}》${project.work.作者 ? ` 作者：${project.work.作者}` : ''}`);
  lines.push(`卷：第 ${volume} 卷 ${volumeName}`);
  lines.push('');

  if (outline) {
    lines.push(`## 本卷大纲`);
    lines.push('');
    lines.push(outline.body.trim() || '（卷大纲还是空的）');
    lines.push('');
  }

  if (targetChapter) {
    lines.push(`## 本章已登记`);
    lines.push('');
    lines.push(`标题：${targetChapter.meta.标题}`);
    if (targetChapter.meta.摘要) lines.push(`摘要：${targetChapter.meta.摘要}`);
    if (targetChapter.meta.埋.length > 0) lines.push(`埋：${targetChapter.meta.埋.join('、')}`);
    if (targetChapter.meta.收.length > 0) lines.push(`收：${targetChapter.meta.收.join('、')}`);
    lines.push('');
  }

  const knowledgeLines: string[] = [];
  for (const [personId, settings] of knowledge) {
    for (const [settingId, state] of settings) {
      const setting = settingById.get(settingId);
      knowledgeLines.push(
        `- ${personLabel(personId)} ${state}「${setting?.描述 ?? settingId}」（${settingId}）`,
      );
    }
  }
  if (knowledgeLines.length > 0) {
    lines.push('## 截至上一章的角色认知');
    lines.push('');
    lines.push(...knowledgeLines);
    lines.push('');
  }

  if (relations.size > 0) {
    lines.push('## 截至上一章的人物关系');
    lines.push('');
    for (const item of relations.values()) {
      lines.push(`- ${personLabel(item.甲)} 与 ${personLabel(item.乙)}：${item.变为}`);
    }
    lines.push('');
  }

  const dangling = entries.伏笔.filter((item) => item.状态 === '悬空');
  if (dangling.length > 0) {
    lines.push('## 未回收伏笔');
    lines.push('');
    for (const item of dangling) {
      const plan = item.预期回收 ? `，计划第 ${item.预期回收} 章收` : '';
      lines.push(`- ${item.编号}「${item.描述}」埋于第 ${item.埋 ?? '未标'} 章${plan}`);
    }
    lines.push('');
  }

  if (entries.设定.length > 0) {
    lines.push('## 设定');
    lines.push('');
    for (const item of entries.设定) {
      const parts = [`- ${item.编号} [${item.类型}] ${item.描述}`];
      if (item.生效) parts.push(`生效于 ${item.生效}`);
      if (item.揭示) parts.push(`揭示于 ${item.揭示}`);
      lines.push(parts.join('，'));
    }
    lines.push('');
  }

  if (happenedBefore.size > 0) {
    const sorted = [...happenedBefore.entries()].sort((a, b) => compareChapter(a[1], b[1]));
    lines.push('## 已经发生的事件');
    lines.push('');
    for (const [id, chapter] of sorted) {
      lines.push(`- ${id}（第 ${chapter} 章）${eventById.get(id)?.描述 ?? ''}`);
    }
    lines.push('');
  }

  const previousChapters = chapters
    .filter((item) => compareChapter(item.chapter, target) < 0)
    .slice(-recentCount);
  if (previousChapters.length > 0) {
    lines.push(`## 最近 ${previousChapters.length} 章概要`);
    lines.push('');
    for (const chapter of previousChapters) {
      lines.push(`- 第 ${chapter.chapter} 章 ${chapter.meta.标题}：${brief(chapter)}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/** 摘要优先用作者填的；没填就取正文首段前 200 字，绝不空着。 */
function brief(chapter: Chapter): string {
  if (chapter.meta.摘要) return chapter.meta.摘要;
  const firstParagraph =
    chapter.body
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith('#')) ?? '';
  if (!firstParagraph) return '（还没写正文）';
  return firstParagraph.length > 200 ? `${firstParagraph.slice(0, 200)}…` : firstParagraph;
}
