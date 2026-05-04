/** Scenario answer memory API — persisted source for AI-Twin (DEE-27). */

export type ScenarioAnswerMemoryDto = {
  id: string;
  scenarioKey: string;
  /** Round-trips parsed JSON stored in SQLite. */
  payload: unknown;
  /** ISO 8601 */
  createdAt: string;
};

export type ScenarioAnswerAppendApiResponse = {
  answer: ScenarioAnswerMemoryDto;
  replayed: boolean;
};

export type ScenarioAnswersListApiResponse = {
  answers: ScenarioAnswerMemoryDto[];
};
