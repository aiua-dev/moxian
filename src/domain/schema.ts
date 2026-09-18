import { z } from 'zod';
import type { Kind } from '../constants.js';

/**
 * 五类契约。字段一律中文，磁盘上人能直接读懂。
 * 设计约束：类型要少、字段要少、主键人能读。
 */

const chapterShape = /^\d+-\d+$/;
const entryShape = /^[FPES]-\d{3,}$/;

/** 章节 frontmatter：只装「按章发生的事」，正文区一个字符都不碰。 */
export const knowledgeEventSchema = z.object({
  人物: z.string(),
  设定: z.string(),
  变为: z.enum(['不知', '存疑', '已知', '误信']),
});

export const relationEventSchema = z.object({
  甲: z.string(),
  乙: z.string(),
  变为: z.string().min(1),
});

export const chapterMetaSchema = z.object({
  章: z.string().regex(chapterShape),
  标题: z.string().min(1),
  /** 故事内时间顺序，选填；缺省按写作序。只有闪回、插叙才需要填。 */
  叙事序: z.number().int().optional(),
  /** 本章一句话概要，选填。打包时优先用它，缺省退化为取正文首段。 */
  摘要: z.string().optional(),
  埋: z.array(z.string()).default([]),
  收: z.array(z.string()).default([]),
  事件: z.array(z.string()).default([]),
  认知: z.array(knowledgeEventSchema).default([]),
  关系: z.array(relationEventSchema).default([]),
});

export type ChapterMeta = z.infer<typeof chapterMetaSchema>;

/** 伏笔与承诺：埋了什么，打算在哪收，收没收。 */
export const foreshadowSchema = z.object({
  编号: z.string().regex(entryShape),
  描述: z.string().min(1),
  埋: z.string().optional(),
  预期回收: z.string().optional(),
  回收: z.string().optional(),
  状态: z.enum(['悬空', '已收', '弃用']).default('悬空'),
  关联: z.array(z.string()).default([]),
  备注: z.string().optional(),
});

/** 人物：只存静态身份信息。知道什么、跟谁什么关系一律由章节事件推导。 */
export const personSchema = z.object({
  编号: z.string().regex(entryShape),
  名: z.string().min(1),
  别名: z.array(z.string()).default([]),
  身份: z.string().optional(),
  描述: z.string().optional(),
  备注: z.string().optional(),
});

/** 时间线：一个事件一条。发生在哪章由章节 frontmatter 的 事件 字段反推。 */
export const timelineSchema = z.object({
  编号: z.string().regex(entryShape),
  描述: z.string().min(1),
  时间: z.string().optional(),
  前置: z.array(z.string()).default([]),
  备注: z.string().optional(),
});

/** 设定：世界规则与世界真相。真相是对读者揭示的秘密，规则是约束。 */
export const settingSchema = z.object({
  编号: z.string().regex(entryShape),
  描述: z.string().min(1),
  类型: z.enum(['规则', '真相']).default('规则'),
  生效: z.string().optional(),
  揭示: z.string().optional(),
  备注: z.string().optional(),
});

export type Foreshadow = z.infer<typeof foreshadowSchema>;
export type Person = z.infer<typeof personSchema>;
export type TimelineEvent = z.infer<typeof timelineSchema>;
export type Setting = z.infer<typeof settingSchema>;

export const ENTRY_SCHEMAS = {
  伏笔: foreshadowSchema,
  人物: personSchema,
  时间线: timelineSchema,
  设定: settingSchema,
} satisfies Record<Kind, z.ZodType>;

export type EntryOf<K extends Kind> = z.infer<(typeof ENTRY_SCHEMAS)[K]>;

/** 作品.yaml：一部作品的元信息与卷册结构。 */
export const workSchema = z.object({
  格式版本: z.string(),
  书名: z.string().min(1),
  作者: z.string().optional(),
  卷: z
    .array(
      z.object({
        序号: z.number().int().positive(),
        名: z.string().min(1),
      }),
    )
    .default([]),
});

export type Work = z.infer<typeof workSchema>;

/** 卷大纲 frontmatter：卷级规划。章级预期由正文 frontmatter 的 摘要 承担。 */
export const outlineMetaSchema = z.object({
  卷: z.number().int().positive(),
  名: z.string().min(1),
  规划: z.array(z.string().regex(chapterShape)).default([]),
});

export type OutlineMeta = z.infer<typeof outlineMetaSchema>;
