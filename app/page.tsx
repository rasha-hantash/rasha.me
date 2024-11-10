// app/page.tsx
"use client";

import { useState, useEffect } from "react";
import ResumeSection from "@/components/ResumeSection";
import SystemInfo from "@/components/SystemInfo";

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState("");

  useEffect(() => {
    setLoading(false);
  }, []);

  if (loading) {
    return <div className="bg-black text-[#ffb000] h-screen">Loading...</div>;
  }

  const sections = [
    { hex: "0xA000", name: "ABOUT", id: "about-section" },
    // { hex: "0xB000", name: "SKILLS", id: "skills-section" },
    { hex: "0xC000", name: "PROJECTS", id: "projects-section" },
    { hex: "0xD000", name: "RESUME", id: "resume-section" },
    { hex: "0xE000", name: "HACKATHONS", id: "hackathons-section" },
  ];

  // Add this scroll function
  const scrollToSection = (name: string, id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
    setActiveSection(name);
  };

  return (
    <main className="min-h-screen bg-black text-[#ffb000] p-5 font-mono relative overflow-hidden">
      <SystemInfo />
      {/* CRT and Scan Effects */}
      <div className="pointer-events-none fixed inset-0 bg-gradient-to-b from-transparent to-black/50" />
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(transparent_0px,transparent_1px,rgba(255,176,0,0.07)_2px,rgba(255,176,0,0.07)_3px)] bg-[size:100%_3px]" />
      <div className="pointer-events-none fixed top-0 left-0 right-0 h-1 bg-[#ffb000]/20 animate-scanline" />

      <div className="max-w-6xl mx-auto border-2 border-[#ffb000] p-5 relative">
        {/* Terminal Header */}
        <div className="border-b border-[#ffb000] pb-1 mb-8">
          <div>Welcome to ROBCO Industries (TM) TermLink</div>
          <div className="text-xl font-bold mb-2">
            Rasha Hantash, Technician Class 4
          </div>
          <div className="mt-5">
            <div>Authentication Status: GRANTED</div>
          </div>
          {/* Navigation Sections */}
          <div className="justify-end mt-5 right-0 flex flex-wrap gap-2 text-xs">
            {sections.map((section) => (
              <button
                key={section.hex}
                onClick={() => scrollToSection(section.name, section.id)}
                className={`hover:bg-[#ffb000] hover:text-black focus:bg-[#ffb000] focus:text-black focus:outline-none group relative transition-colors
                ${
                  activeSection === section.name
                    ? "bg-[#ffb000] text-black"
                    : "hover:border-[#ffb000]"
                }`}
              >
                <span className="opacity-60 mr-1">[{section.name}]</span>
              </button>
            ))}
          </div>
        </div>

        {/* Links */}
        <div className="mb-8">
          <span className="opacity-60 mr-3">0xBC80</span>
          <a
            href="mailto:rasha.hantash@protonmail.com"
            target="_blank"
            rel="noopener noreferrer"
            className="mr-2 focus:bg-[#ffb000] focus:text-black focus:outline-none hover:bg-[#ffb000] hover:text-black "
          >
            [EMAIL]
          </a>
          <a
            href="https://github.com/rasha-hantash"
            target="_blank"
            rel="noopener noreferrer"
            className="mr-2 focus:bg-[#ffb000] focus:text-black focus:outline-none hover:bg-[#ffb000] hover:text-black "
          >
            [GITHUB]
          </a>
          <a
            href="https://linkedin.com/in/rasha-hantash"
            target="_blank"
            rel="noopener noreferrer"
            className="mr-2 focus:bg-[#ffb000] focus:text-black focus:outline-none hover:bg-[#ffb000] hover:text-black "
          >
            [LINKEDIN]
          </a>
          <a
          href="/RashaHantash-Resume.pdf"
          download="Rasha-Hantash_Resume.pdf"
          target="_blank"
          rel="noopener noreferrer"
          className="focus:bg-[#ffb000] focus:text-black focus:outline-none hover:bg-[#ffb000] hover:text-black"
        >
          [DOWNLOAD_RESUME]
        </a>
        </div>

        {/* Content Grid */}
        <div
          id="about-section"
          className="grid grid-cols-1 md:grid-cols-2 gap-10"
        >
          <div className="border border-[#ffb000] p-5">
            <span className="opacity-60 mr-3">0xBD04</span>
            <h2 className="text-xl">{">"}MANIFESTO</h2>
            <div className="text-xs mb-4">
              Humanitarian / Ex-Founder / Senior Software Engineer
            </div>
            <p className="leading-relaxed">
              Architect of scalable systems. Co-founded rebellion against
              corporate mischief, channeling millions of dollars back to the
              people. Specialized in building secure, resilient systems that
              scale from prototype to production. Delivering delightful products
              by day, dreaming of tech-driven human unity by night.
            </p>
          </div>

          <div className="border border-[#ffb000] p-5">
            <span className="opacity-60 mr-3">0xBE08</span>
            <h2 className="text-xl mb-4">{">"}TECHNICAL EXPERTISE</h2>
            <p className="leading-relaxed">
              HIGHLY SKILLED IN:
              <br />
              - Golang
              <br />
              - REST / gRPC
              <br />
              - PostgreSQL
              <br />
              - Infrastructure (Terraform/AWS/Docker)
              <br />
              - Next.js / TailwindCSS
              <br />
              - RabbitMQ
              <br />
              - Authentication / Authorization (Auth0)
              <br />- CI/CD (Github Actions)
            </p>
          </div>
        </div>

        {/* Projects */}
        <div id="projects-section" className="mt-8">
          <span className="opacity-60 mr-3">0xBF10</span>
          <h2 className="text-xl mb-4">{">"}PROJECTS</h2>
          {[
            {
              hex: "0xBF20",
              title:
                "HA Fullstack Application w/ RBAC [AUTH0/NextJS/GO/POSTGRES/DOCKER/TF/AWS]",
              href: "https://github.com/rasha-hantash/fullstack-traba-copy-cat",
            },
            {
              hex: "0xBF40",
              title:
                "Fan-out Messaging System w/ RBAC [AUTH0/GOLANG/DOCKER/RABBITMQ]",
              href: "https://github.com/rasha-hantash/golang/tree/main/distributedsystems",
            },
            {
              hex: "0xBF60",
              title: "Payments And Ledgering [GO/DOCKER]",
              href: "https://github.com/rasha-hantash/payments",
            },
            {
              hex: "0xBF80",
              title: "Algo-Trader - WIP [NEXTJS/GOLANG]",
              href: "https://github.com/rasha-hantash/algo-trader",
            },
          ].map((project) => (
            <a
              key={project.hex}
              href={project.href}
              target="_blank"
              rel="noopener noreferrer"
              className="block mb-2 p-1 focus:bg-[#ffb000] focus:text-black focus:outline-none  hover:bg-[#ffb000] hover:text-black transition-colors"
            >
              {project.hex} {">"} {project.title}
            </a>
          ))}
        </div>
        <ResumeSection id="resume-section" secondaryId="hackathons-section" />
      </div>
    </main>
  );
}
