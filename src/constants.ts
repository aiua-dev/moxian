/**
 * 工具身份只出现在本文件。整体改名（例如改成 novelstack）时只改这里，
 * 其余代码一律引用 TOOL.name，避免名字散落到各处。
 */
export const TOOL = {
  name: 'moxian',
  display: '墨线',
  version: '0.1.0',
} as const;

/** 一部作品一个根：这些是根下的全部内容，只有三个目录。 */
export const PROJECT_FILE = '作品.yaml';
export const DIR_TEXT = '正文';
export const DIR_OUTLINE = '大纲';
export const DIR_CONTINUITY = '连续性';

/** 作品格式版本，写进 作品.yaml，用于将来迁移判断。 */
export const FORMAT_VERSION = '1.0';

/** 四类条目的类型标识。大纲单独处理，它落在 大纲/ 目录。 */
export const KINDS = ['伏笔', '人物', '时间线', '设定'] as const;
export type Kind = (typeof KINDS)[number];

/** 每类的编号前缀，人能读、能手搜。 */
export const KIND_PREFIX: Record<Kind, string> = {
  伏笔: 'F',
  人物: 'P',
  时间线: 'E',
  设定: 'S',
};

/** 悬空伏笔的提醒阈值（章数）。 */
export const DANGLING_THRESHOLD = 30;
