export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class SkillValidationError extends Error {
  constructor(skillId: string, message: string) {
    super(`Skill ${skillId} 无效: ${message}`);
    this.name = "SkillValidationError";
  }
}
