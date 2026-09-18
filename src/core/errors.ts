import type { z } from 'zod';

/** 用户可见的错误：命令层捕获后打印 message 并以该退出码结束。 */
export class MoxianError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = 'MoxianError';
    this.exitCode = exitCode;
  }
}

/** 把 zod 的报错压成一行中文，指到具体字段。 */
export function describeZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const where = issue.path.length > 0 ? issue.path.join('.') : '根';
      return `${where} ${issue.message}`;
    })
    .join('；');
}
