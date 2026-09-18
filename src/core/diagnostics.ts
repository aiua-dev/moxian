/**
 * 诊断分为两级。
 * 硬错：结构上就不成立，写入时立刻拦住，不写进去。
 * 提醒：内容上可疑但可能是作者有意为之，只在 校验 命令里汇总，不打断写作。
 */
export type Severity = '硬错' | '提醒';

export interface Diagnostic {
  /** 规则编号，E 开头是硬错，W 开头是提醒。 */
  rule: string;
  severity: Severity;
  message: string;
  /** 出问题的位置：文件路径或对象编号。 */
  where?: string;
}

export function hardError(rule: string, message: string, where?: string): Diagnostic {
  return { rule, severity: '硬错', message, where };
}

export function warning(rule: string, message: string, where?: string): Diagnostic {
  return { rule, severity: '提醒', message, where };
}

/** 硬错规则编号。结构上不成立的事，写入时就得拦住。 */
export const RULES = {
  REF_MISSING: 'E001',
  ID_DUPLICATED: 'E002',
  CHAPTER_SHAPE: 'E003',
  CHAPTER_NUMBER_TAKEN: 'E004',
  ORDER_INVERTED: 'E005',
  UNKNOWN_VOLUME: 'E006',
  KIND_MISMATCH: 'E007',
  STATE_CONTRADICTION: 'E008',
  SYNC_MISMATCH: 'E009',
} as const;

export const WARNINGS = {
  DANGLING: 'W001',
  OVERDUE: 'W002',
  KNOWLEDGE_EARLY: 'W003',
  OUTLINE_PLANNED_MISSING: 'W004',
  OUTLINE_UNPLANNED_TEXT: 'W005',
  SYNC_INCOMPLETE: 'W006',
} as const;

export function summarize(diagnostics: readonly Diagnostic[]): {
  hard: Diagnostic[];
  soft: Diagnostic[];
} {
  return {
    hard: diagnostics.filter((item) => item.severity === '硬错'),
    soft: diagnostics.filter((item) => item.severity === '提醒'),
  };
}
