import { Github, Linkedin, CalendarDays } from "lucide-react";

export default function Home() {
  return (
    <div className="grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen  pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
      <main className="flex flex-col gap-8 row-start-2 items-center sm:items-start">
        <div className="text-4xl font-semibold">Rasha Hantash</div>
        <ol className="list-inside list-decimal text-sm text-center sm:text-left font-[family-name:var(--font-geist-mono)]">
          <ul className="mb-2">
            Humanitarian / Ex-founder & CTO / Software Engineer
          </ul>
          <li>
            Checked out a library of my side projects{" "}
            <a
              href="https://github.com/rasha-hantash/library"
              className="font-bold underline underline-offset-4 hover:underline-offset-4 hover:underline hover:border-black"
              target="_blank"
              rel="noopener noreferrer"
            >
              <code>here</code>
            </a>
          </li>
          <li>
            Setup a time, check out more if my work, or connect with me below:{" "}
          </li>
          <div className="ml-6 mt-1 row-start-3 flex gap-6 flex-wrap items-center">
            <a
              className="flex items-center gap-2 hover:underline hover:underline-offset-4"
              href="https://cal.com/rasha-hantash/30min"
              target="_blank"
              rel="noopener noreferrer"
            >
              <CalendarDays size={16} />
              Cal.com
            </a>
            <a
              className="flex items-center gap-2 hover:underline hover:underline-offset-4"
              href="https://github.com/rasha-hantash"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Github size={16} />
              Github
            </a>
            <a
              className="flex items-center gap-2 hover:underline hover:underline-offset-4"
              href="https://linkedin.com/in/rasha-hantash"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Linkedin size={16} />
              LinkedIn
            </a>
          </div>
        </ol>
      </main>
    </div>
  );
}
