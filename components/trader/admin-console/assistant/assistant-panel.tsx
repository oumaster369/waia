export function AssistantPanel({
  enabled,
  answers,
}: {
  enabled: boolean;
  answers: readonly { id: string; title: string }[];
}) {
  return (
    <section aria-label="Помощник">
      {enabled ? null : <p>Помощник выключен. Быстрые ответы работают без языковой модели.</p>}
      <ul>
        {answers.map((answer) => (
          <li key={answer.id}>{answer.title}</li>
        ))}
      </ul>
    </section>
  );
}
