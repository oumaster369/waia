/** Diary memory API — persisted source for AI-Twin (DEE-27). Not prompts/UI. */

export type DiaryMemoryEntryDto = {
  id: string;
  body: string;
  /** ISO 8601 */
  createdAt: string;
};

export type DiaryEntryAppendApiResponse = {
  entry: DiaryMemoryEntryDto;
  replayed: boolean;
};

export type DiaryEntriesListApiResponse = {
  entries: DiaryMemoryEntryDto[];
};
