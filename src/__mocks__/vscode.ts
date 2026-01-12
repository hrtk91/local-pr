/**
 * VSCode Mock for testing
 */

export enum CommentMode {
  Preview = 0,
  Editing = 1,
}

export enum CommentThreadCollapsibleState {
  Collapsed = 0,
  Expanded = 1,
}

export class Range {
  constructor(
    public startLine: number,
    public startCharacter: number,
    public endLine: number,
    public endCharacter: number
  ) {}
}

export class Uri {
  constructor(public fsPath: string) {}
  static file(path: string) {
    return new Uri(path);
  }
}

export class MarkdownString {
  constructor(public value: string = '') {}
}

export const window = {
  showInformationMessage: () => {},
  showErrorMessage: () => {},
  showWarningMessage: () => Promise.resolve(undefined),
};

export const workspace = {
  workspaceFolders: undefined,
};

export const comments = {
  createCommentController: () => ({
    dispose: () => {},
  }),
};
