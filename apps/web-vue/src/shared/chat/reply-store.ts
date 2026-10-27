export interface ReplyAuthor {
  id?: string | undefined;
  name?: string | undefined;
}

export interface ReplyTarget {
  messageId: string;
  deleted: boolean;
  author?: ReplyAuthor | undefined;
  text?: string | undefined;
}
