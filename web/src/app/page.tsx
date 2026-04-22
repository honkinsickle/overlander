import Link from "next/link";

export default function Home() {
  return (
    <main className="flex flex-col items-start gap-6 p-10 text-text-primary">
      <h1 className="font-display text-2xl uppercase tracking-[0.06em]">
        Overlander
      </h1>
      <p className="text-text-muted max-w-md font-sans">
        Scaffold stub. Trip flows live under <code>/trip/[id]</code>.
      </p>
      <Link
        href="/trip/la-to-portland"
        className="px-4 py-2 rounded text-text-primary bg-button-primary hover:bg-button-primary-hover border border-button-primary-border"
      >
        Open sample trip →
      </Link>
    </main>
  );
}
