import React from "react";

interface ResumeSectionProps {
  id: string;
  secondaryId: string;
}

export default function ResumeSection({ id, secondaryId }: ResumeSectionProps) {
  const experiences = [
    {
      hex: "0xBF20",
      title:
        "Co-founder & CTO | ClaimClam [NEXTJS/TAILWINDCSS/GO/TF/AWS]",
      duration: "January 2023 – June 2024",
      accomplishments: [
        "Built payment infrastructure processing $1.2M+ in claims with double-entry ledger system",
        "Scaled platform from Airtable to Aurora, supporting 45k users and 8-figure settlements",
        "Led technical evaluation of payment processors, optimizing for scale and cost efficiency",
        "Raised $1.95M across two rounds ($450K angel, $1.5M pre-seed) within 6 months",
        "Managed 3-person engineering team, implementing CI/CD and agile workflows",
        "Developed MVP that processed 30k JUUL claims ($3.01M) in six weeks",
      ],
    },
    {
      hex: "0xBF40",
      title: "Platform Engineer | Quantum Metric [GOLANG/K8S]",
      duration: "October 2021 – February 2023",
      accomplishments: [
        "Architected real-time anomaly detection system with email notifications via K8s cronjobs",
        "Implemented OpenTelemetry instrumentation across gRPC microservices fleet",
        "Built high-performance session analytics API with Redis caching",
        "Standardized local development environment for platform engineering team",
        "Developed user feedback collection pipeline integrated with BigQuery",
      ],
    },
    {
      hex: "0xBF60",
      title: "Software Engineer | Oort [GOLANG/GCP]",
      duration: "January 2021 – August 2021",
      accomplishments: [
        "Designed analytics pipeline using Kafka, Fluentd, and BigQuery",
        "Built automated CI/CD workflow for containerized microservices",
        "Implemented K8s deployments via Terraform",
        "Developed real-time data transformation service in Go",
      ],
    },
    {
      hex: "0xBF80",
      title: "Software Engineer | Best Execution Solutions [PYTHON/AWS]",
      duration: "July 2020 – January 2021",
      accomplishments: [
        "Optimized market data processing by 80% through Go migration",
        "Reduced 28k record processing time by 50% using optimized algorithms",
        "Built customer-facing validation system using Django and Knockout.js",
        "Deployed and managed production infrastructure on AWS EC2",
      ],
    },
  ];

  const projects = [
    {
      hex: "0xCA20",
      title: "BiggerBrother [WEB3/ETHEREUM]",
      duration: "ETHGlobal NYC 2023",
      details: [
        "Developed Web3 backend for tracking political campaign promises",
        "Implemented smart contracts for immutable promise tracking",
        "Won multiple pool prizes for technical innovation",
      ],
    },
    {
      hex: "0xCA40",
      title: "ETHHackDao [SOLIDITY/GRAPH]",
      duration: "ETHGlobal SF 2022",
      details: [
        "Built community-driven sponsorship platform for hackathon prizes",
        "Integrated with SKALE network for scalable transactions",
        "Won SKALE pool prize for technical excellence",
      ],
    },
    {
      hex: "0xCA60",
      title: "ZeroPWNd [PYTHON/API]",
      duration: "RamHacks 2018",
      details: [
        "Created ML-powered phishing detection system",
        "Integrated multiple public security APIs",
        "Won first place in WillowTree security challenge",
      ],
    },
  ];

  return (
    <div id={id} className="mt-8">
      {/* Header section with responsive layout */}
      <div className="mb-8">
        {/* On small screens, hex and title stack vertically */}
        <div className="md:hidden mb-4">
          <span className="block opacity-60 mb-2 font-mono">{experiences[0].hex}</span>
          <h2 className="text-xl font-medium">RESUME</h2>
        </div>
        
        {/* On medium screens and up, hex and title are side by side */}
        <div className="hidden md:flex items-center mb-4">
          <span className="opacity-60 mr-3 font-mono">{experiences[0].hex}</span>
          <h2 className="text-xl font-medium">RESUME</h2>
        </div>
      </div>

      {/* Experience sections */}
      {experiences.map((exp) => (
        <div key={exp.hex} className="mb-8">
          <div className="flex flex-col md:flex-row md:items-start">
            {/* Hide this hex on small screens since it's shown above */}
            <span className="hidden md:block opacity-60 mr-3 font-mono">{exp.hex}</span>
            <div className="flex-1">
              <h3 className="font-medium text-lg">{exp.title}</h3>
              <p className="text-sm opacity-70 mb-2">{exp.duration}</p>
              <ul className="list-none space-y-1">
                {exp.accomplishments.map((acc, idx) => (
                  <li key={idx} className="text-sm opacity-80 pl-4 relative">
                    <span className="absolute left-0">&gt;</span>
                    {acc}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ))}

<div id={secondaryId} className="mt-12">
      {/* Header section with responsive layout */}
      <div className="mb-6">
        {/* Mobile layout - stacked */}
        <div className="md:hidden mb-4">
          <span className="block opacity-60 mb-2 font-mono">0xCA10</span>
          <h2 className="text-xl font-medium">HACKATHONS</h2>
        </div>

        {/* Desktop layout - side by side */}
        <div className="hidden md:flex items-center mb-4">
          <span className="opacity-60 mr-3 font-mono">0xCA10</span>
          <h2 className="text-xl font-medium">HACKATHONS</h2>
        </div>
      </div>

      {/* Projects list */}
      {projects.map((project) => (
        <div key={project.hex} className="mb-6">
          <div className="flex flex-col md:flex-row md:items-start">
            <span className="hidden md:block opacity-60 mr-3 font-mono">{project.hex}</span>
            <div className="w-full">
              <h3 className="font-medium">{project.title}</h3>
              <p className="text-sm opacity-70 mb-2">{project.duration}</p>
              <ul className="list-none space-y-1">
                {project.details.map((detail, idx) => (
                  <li key={idx} className="text-sm opacity-80 pl-4 relative">
                    <span className="absolute left-0">&gt;</span>
                    {detail}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ))}
    </div>
    </div>
  );
}
