// app/page.tsx
"use client";

import { useState, useEffect } from "react";
import ResumeSection from "@/components/ResumeSection";
import SystemInfo from "@/components/SystemInfo";

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState("ABOUT");

  useEffect(() => {
    setLoading(false);
  }, []);

  if (loading) {
    return <div className="bg-black text-[#ffb000] h-screen">Loading...</div>;
  }

  const sections = [
    { hex: "0xA000", name: "ABOUT" },
    { hex: "0xB000", name: "SKILLS" },
    { hex: "0xC000", name: "PROJECTS" },
    { hex: "0xD000", name: "RESUME" },
    { hex: "0xE000", name: "HACKATHONS" },
  ];

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
          <div className="text-xl font-bold mb-2">Rasha Hantash, Technician Class 4</div>
          <div className="mt-5">
            <div>Authentication Status: GRANTED</div>
          </div>
          {/* Navigation Sections */}
          <div className="justify-end mt-5 right-0 flex flex-wrap gap-2 text-xs">
            {sections.map((section) => (
              <button
                key={section.hex}
                onClick={() => setActiveSection(section.name)}
                className={`hover:bg-[#ffb000] hover:text-black  group relative  transition-colors
            ${
              activeSection === section.name
                ? "bg-[#ffb000] text-black"
                : "hover:border-[#ffb000] "
            }`}
              >
                <div
                  className=""
                ></div>
                <span className="opacity-60 mr-1">[{section.name}]
                </span>
              </button>
            ))}
          </div>
        </div>
      

        {/* Links */}
        <div className="mb-8">
          <span className="opacity-60 mr-3">0xBC80</span>
          <a
            href="mailto:rasha.hantash@protonmail.com"
            className="mr-5 hover:bg-[#ffb000] hover:text-black "
          >
            [EMAIL]
          </a>
          <a
            href="https://github.com/rasha-hantash"
            className="mr-5 hover:bg-[#ffb000] hover:text-black "
          >
            [GITHUB]
          </a>
          <a
            href="https://linkedin.com/in/rasha-hantash"
            className="hover:bg-[#ffb000] hover:text-black "
          >
            [LINKEDIN]
          </a>
        </div>

        {/* Content Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
          <div className="border border-[#ffb000] p-5">
            <span className="opacity-60 mr-3">0xBD04</span>
            <h2 className="text-xl">{">"}MANIFESTO</h2>
            <div className="text-xs mb-4">
              Humanitarian / Ex-Founder / Senior Software Engineer
            </div>
            <p className="leading-relaxed">
            Architect of scalable systems. Co-founded rebellion against corporate mischief, 
            channeling millions of dollars back to the people. Specialized in building secure, resilient systems that scale from prototype to production.
            Delivering delightful products by day, dreaming of tech-driven human unity by night.
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
        <div className="mt-8">
          <span className="opacity-60 mr-3">0xBF10</span>
          <h2 className="text-xl mb-4">{">"}PROJECTS</h2>
          {[
            { hex: "0xBF20", title: "Distributed Task Scheduler [GO/AWS]" },
            {
              hex: "0xBF40",
              title: "Real-time Analytics Platform [NEXT.JS/POSTGRES]",
            },
            { hex: "0xBF60", title: "Authentication Microservice [GO/AUTH0]" },
            {
              hex: "0xBF80",
              title: "Infrastructure as Code Templates [TERRAFORM]",
            },
          ].map((project) => (
            <a
              key={project.hex}
              href="#"
              className="block mb-2 p-1 hover:bg-[#ffb000] hover:text-black transition-colors"
            >
              {project.hex} {">"} {project.title}
            </a>
          ))}
        </div>
        <ResumeSection />
      </div>
    </main>
  );
}
