export default function HomePage() {
  return (
    <main
      data-testid="home"
      className="mx-auto flex min-h-screen max-w-3xl flex-col items-start justify-center gap-6 px-6 py-24"
    >
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">WAIA</h1>
      <p className="text-lg text-muted-foreground">
        Open AI infrastructure for humans, businesses and society.
      </p>
    </main>
  );
}
