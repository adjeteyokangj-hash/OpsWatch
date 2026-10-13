import type { MarketingPageContent } from "./types";

export const marketingPages: Record<string, MarketingPageContent> = {
  home: {
    slug: "home",
    cmsKey: "opswatch.page.home",
    metaTitle: "OpsWatch | Application health and incident remediation",
    metaDescription:
      "Monitor application health without agents, understand topology impact, and remediate incidents with governed automation.",
    hero: {
      eyebrow: "Agentless application health platform",
      title: "Command Center for application health and recovery",
      subtitle:
        "OpsWatch watches public URLs, services and dependencies without agents, then helps operators diagnose impact and run governed remediation with verification.",
      primaryCta: { label: "Start monitoring", href: "/register" },
      secondaryCta: { label: "Explore the platform", href: "/platform" },
      showCommandCenterPreview: true,
      pills: [
        "Agentless URL and HTTP checks",
        "Topology-aware incidents",
        "Approval-gated remediation"
      ]
    },
    sections: [
      {
        id: "capabilities",
        cmsKey: "opswatch.page.home.capabilities",
        title: "Verified capabilities operators can trust",
        body: "Every capability below is labelled with its current product state. Unfinished work is never presented as live monitoring.",
        cards: [
          {
            id: "checks",
            title: "Agentless health checks",
            state: "Live",
            href: "/features",
            body: "Register public and admin URLs, run HTTP and SSL checks, and surface health, alerts and recovery without installing an agent."
          },
          {
            id: "topology",
            title: "Advanced topology",
            state: "Live",
            href: "/platform",
            body: "Understand how services, workflows and components relate so incidents show blast radius instead of isolated noise."
          },
          {
            id: "remediation",
            title: "Governed remediation",
            state: "Live",
            href: "/ai-intelligence",
            body: "Propose repairs, require approval where needed, and execute only registered actions with verification after the change."
          }
        ]
      },
      {
        id: "monitoring",
        cmsKey: "opswatch.page.home.monitoring",
        eyebrow: "Application monitoring",
        title: "Watch the surfaces that matter",
        body: "Track frontend URLs, APIs, SSL certificates and connected services. Portfolio views show which applications are healthy, degraded or down.",
        ctas: [{ label: "See monitoring features", href: "/features", variant: "ghost" }]
      },
      {
        id: "intelligence",
        cmsKey: "opswatch.page.home.intelligence",
        tone: "band",
        eyebrow: "AI intelligence",
        title: "Monitor, analyse, learn, then recover",
        body: "OpsWatch correlates alerts and check failures into incidents, calculates baselines and assists recovery. Predictions remain disabled until learning evidence is verified."
      },
      {
        id: "recovery",
        cmsKey: "opswatch.page.home.recovery",
        eyebrow: "Automated recovery",
        title: "Repair under operator policy",
        body: "Run verified remediation actions where providers are registered. Higher-risk steps stay behind approvals, maintenance windows and auto-run policy.",
        ctas: [{ label: "Review AI and remediation", href: "/ai-intelligence", variant: "ghost" }]
      },
      {
        id: "integrations",
        cmsKey: "opswatch.page.home.integrations",
        title: "Integrations ready for connection",
        body: "Available modes create real monitoring evidence. Preview and planned connectors stay clearly labelled."
      },
      {
        id: "pricing",
        cmsKey: "opswatch.page.home.pricing",
        tone: "soft",
        title: "Plans that match how OpsWatch bills",
        body: "Subscriptions are chosen per application after you sign in. Prices mirror the live plan catalogue.",
        ctas: [
          { label: "Compare full pricing", href: "/pricing", variant: "outline" },
          { label: "Talk about Enterprise", href: "/contact?topic=enterprise", variant: "primary" }
        ]
      },
      {
        id: "cta",
        cmsKey: "opswatch.page.home.cta",
        title: "Open the Command Center when you are ready",
        body: "Existing customers sign in to the operational workspace. New teams can register and connect their first application URL in minutes.",
        ctas: [
          { label: "Sign in", href: "/login", variant: "secondary" },
          { label: "Create account", href: "/register", variant: "primary" }
        ]
      }
    ]
  },
  platform: {
    slug: "platform",
    cmsKey: "opswatch.page.platform",
    metaTitle: "Platform",
    metaDescription:
      "Explore the OpsWatch platform: agentless health, topology, incidents, and governed remediation.",
    hero: {
      eyebrow: "Platform",
      title: "One operational spine for health, impact and repair",
      subtitle:
        "OpsWatch connects monitoring evidence to topology context and remediation workflows so operators can move from detection to recovery without switching tools.",
      primaryCta: { label: "Start monitoring", href: "/register" },
      secondaryCta: { label: "Browse features", href: "/features" },
      showCommandCenterPreview: true
    },
    sections: [
      {
        id: "capabilities",
        cmsKey: "opswatch.page.platform.capabilities",
        cards: [
          {
            id: "url-onboarding",
            title: "URL-first onboarding",
            state: "Live",
            body: "Create persistent public or admin URL connections and provision HTTP and SSL checks directly from application onboarding."
          },
          {
            id: "topology",
            title: "Canonical topology",
            state: "Live",
            body: "Entities and relationships stay on one model so dashboards, incidents and automation share the same dependency view."
          },
          {
            id: "incidents",
            title: "Incident correlation",
            state: "Live",
            body: "Related alerts and check failures roll into incidents with ownership, severity and recovery tracking."
          },
          {
            id: "otel",
            title: "OpenTelemetry bridge",
            state: "Live",
            body: "Normalized OTEL signals enrich the operational spine for alerts, incidents and topology freshness."
          },
          {
            id: "playbooks",
            title: "Automation playbooks",
            state: "Live",
            body: "Plan multi-step repairs through the existing safety pipeline, with approvals and verification where required."
          },
          {
            id: "logs-apm",
            title: "Logs and APM search",
            state: "Foundation",
            body: "Request latency, throughput and searchable logs are building on the observability foundation and are not claimed as complete APM."
          }
        ]
      },
      {
        id: "command-center",
        cmsKey: "opswatch.page.platform.command-center",
        tone: "band",
        title: "What the Command Center is for",
        body: "After you sign in, the Command Center is the authenticated workspace for dashboards, applications, incidents, connections, automation and billing. The public site explains the product. The Command Center runs it.",
        ctas: [
          { label: "Sign in to Command Center", href: "/login", variant: "primary" },
          { label: "Compare plans", href: "/pricing", variant: "outline" }
        ]
      }
    ]
  },
  features: {
    slug: "features",
    cmsKey: "opswatch.page.features",
    metaTitle: "Features",
    metaDescription: "OpsWatch features with honest Live, Available, Preview, and Foundation labels.",
    hero: {
      eyebrow: "Features",
      title: "Capabilities labelled by verification state",
      subtitle:
        "We show what is live, what is preview, and what is still foundation work. Unfinished surfaces are never presented as production monitoring.",
      primaryCta: { label: "Start monitoring", href: "/register" },
      secondaryCta: { label: "See integrations", href: "/integrations" }
    },
    sections: [
      {
        id: "live",
        cmsKey: "opswatch.page.features.live",
        title: "Live and available",
        body: "Live means a verified end-to-end product path. Available means implemented and selectable; operational vendor connections still require configuration and verification.",
        cards: [
          {
            id: "checks",
            title: "HTTP, SSL and keyword checks",
            state: "Live",
            body: "Worker-executed checks store results, drive health, raise alerts and support recovery evidence."
          },
          {
            id: "portfolio",
            title: "Application portfolio health",
            state: "Live",
            body: "See healthy, degraded and down applications with last signal timing and check outcomes."
          },
          {
            id: "topology",
            title: "Topology and dependency impact",
            state: "Live",
            body: "Canonical entities and relationships show how failures propagate across modules and workflows."
          },
          {
            id: "incidents",
            title: "Incidents and alerts",
            state: "Live",
            body: "Operational records stay linked to projects, services and remediation actions."
          },
          {
            id: "remediation",
            title: "Suggested and approved remediation",
            state: "Live",
            body: "Registered executors can repair when policy allows. Unsupported catalogue actions stay planning-only."
          },
          {
            id: "billing",
            title: "Per-application billing",
            state: "Live",
            body: "Choose Pilot, Growth, Business or Enterprise per application and check out through Stripe when configured."
          },
          {
            id: "connectors",
            title: "Advanced Observability Integrations",
            state: "Available",
            body: "Connect supported monitoring and telemetry sources to bring application health, performance signals and dependency information into OpsWatch."
          }
        ]
      },
      {
        id: "preview",
        cmsKey: "opswatch.page.features.preview",
        title: "Preview and foundation",
        body: "Useful paths that are incomplete, gated or still collecting evidence.",
        cards: [
          {
            id: "baselines",
            title: "Intelligence baselines and patterns",
            state: "Preview",
            body: "Calculated baselines and operational patterns help orientation. They are not marketed as autonomous prediction."
          },
          {
            id: "journeys",
            title: "Synthetic journeys",
            state: "Preview",
            body: "Journey drafts can be stored, but execution is not enabled. Drafts never count as active monitoring."
          },
          {
            id: "predictions",
            title: "Predictions",
            state: "Coming soon",
            body: "Prediction emission stays disabled until learning evidence and feedback loops are verified."
          },
          {
            id: "logs",
            title: "Searchable logs and APM",
            state: "Foundation",
            body: "Telemetry foundations exist. Full searchable log and APM product depth is still expanding."
          },
          {
            id: "security",
            title: "Security threat analytics",
            state: "Foundation",
            body: "Auth, credentials, roles and audit are live. Broader detection analytics remain foundation work."
          }
        ]
      }
    ]
  },
  "ai-intelligence": {
    slug: "ai-intelligence",
    cmsKey: "opswatch.page.ai-intelligence",
    metaTitle: "AI Intelligence",
    metaDescription:
      "OpsWatch AI diagnosis, baselines, and automation assist with honest limits on prediction claims.",
    hero: {
      eyebrow: "AI Intelligence",
      title: "Explain impact. Assist recovery. Do not invent certainty.",
      subtitle:
        "OpsWatch uses AI and calculated intelligence to help operators understand incidents and choose repairs. Predictions are not offered as live product claims while learning remains gated.",
      primaryCta: { label: "Try Growth features", href: "/register" },
      secondaryCta: { label: "See plan gates", href: "/pricing" }
    },
    sections: [
      {
        id: "pipeline",
        cmsKey: "opswatch.page.ai-intelligence.pipeline",
        tone: "band",
        eyebrow: "Intelligence path",
        title: "Monitor, analyse, learn, then recover",
        body: "Distinct from the Command Center preview: this path shows how evidence becomes diagnosis and governed repair."
      },
      {
        id: "capabilities",
        cmsKey: "opswatch.page.ai-intelligence.capabilities",
        cards: [
          {
            id: "diagnosis",
            title: "Incident diagnosis",
            state: "Live",
            body: "Growth and above can use AI diagnosis over alert, check and topology evidence to summarise likely impact."
          },
          {
            id: "suggestions",
            title: "Remediation suggestions",
            state: "Live",
            body: "Suggested actions stay tied to registered executors and policy. Suggestions are not silent auto-fixes."
          },
          {
            id: "planning",
            title: "Automation planning",
            state: "Live",
            body: "Playbooks can propose multi-step runs that still pass approvals, maintenance windows and safety checks."
          },
          {
            id: "baselines",
            title: "Learning baselines",
            state: "Preview",
            body: "Baselines accumulate from check history and readiness thresholds. They orient operators rather than forecast outages."
          },
          {
            id: "patterns",
            title: "Operational patterns",
            state: "Preview",
            body: "Recurring sequences and calculated patterns appear when evidence exists. Heuristics are labelled as calculated."
          },
          {
            id: "predictions",
            title: "Predictions",
            state: "Coming soon",
            body: "Candidate prediction emission remains feature-gated and reports zero live candidates while disabled."
          }
        ]
      },
      {
        id: "plan-access",
        cmsKey: "opswatch.page.ai-intelligence.plan-access",
        tone: "soft",
        title: "Plan access",
        body: "AI diagnosis starts on Growth. Autonomous remediation is available on Business and Enterprise when policy and provider capability allow it. Pilot includes suggested remediation without AI diagnosis."
      }
    ]
  },
  integrations: {
    slug: "integrations",
    cmsKey: "opswatch.page.integrations",
    metaTitle: "Integrations",
    metaDescription:
      "OpsWatch connection modes that are available today, plus preview connectors that are not yet live monitoring.",
    hero: {
      eyebrow: "Integrations",
      title: "Connect the surfaces you can actually monitor",
      subtitle:
        "Available modes create real monitoring evidence. Preview and planned connectors are labelled clearly so teams do not confuse a catalogue entry with a live path.",
      primaryCta: { label: "Start monitoring", href: "/register" },
      secondaryCta: { label: "Open Command Center", href: "/login" }
    },
    sections: [
      {
        id: "available",
        cmsKey: "opswatch.page.integrations.available",
        title: "Available now",
        body: "Complete runtime paths when configuration requirements are met.",
        cards: [
          {
            id: "http",
            title: "Agentless HTTP and API",
            state: "Live",
            body: "Probe public endpoints, validate responses and keep health current without installing an agent."
          },
          {
            id: "heartbeat",
            title: "Heartbeat ingest",
            state: "Live",
            body: "Applications can sign and send heartbeats so OpsWatch detects silence and recovery."
          },
          {
            id: "webhooks",
            title: "Webhooks",
            state: "Live",
            body: "Receive signed events into the operational spine for alerts and change correlation."
          },
          {
            id: "otel",
            title: "OpenTelemetry",
            state: "Live",
            body: "Ingest normalized OTEL batches that enrich alerts, incidents and topology freshness."
          },
          {
            id: "sdk",
            title: "SDK and signed ingest",
            state: "Live",
            body: "Client packages and signed project credentials support controlled application reporting."
          },
          {
            id: "remediator",
            title: "Worker remediator hooks",
            state: "Live",
            body: "Register provider capabilities for verified repair actions your application can actually execute."
          },
          {
            id: "observability",
            title: "Advanced Observability Integrations",
            state: "Available",
            body: "Connect supported monitoring and telemetry sources to bring application health, performance signals and dependency information into OpsWatch."
          }
        ]
      },
      {
        id: "planned",
        cmsKey: "opswatch.page.integrations.planned",
        title: "Preview or planned",
        body: "Visible in catalogues for evaluation, not sold as finished monitoring.",
        cards: [
          {
            id: "synthetic",
            title: "Synthetic browser journeys",
            state: "Preview",
            body: "Draft definitions can be stored. Ordered execution, screenshots and journey alerts are not enabled."
          },
          {
            id: "database",
            title: "Cloud database connectors",
            state: "Coming soon",
            body: "Manifest entries may appear for planning, but they cannot be started as live monitoring yet."
          },
          {
            id: "cloudflare",
            title: "Cloudflare backup add-on",
            state: "Coming soon",
            body: "An optional paid Cloudflare backup service is not implemented in the product today and is not offered as live."
          }
        ]
      }
    ]
  },
  solutions: {
    slug: "solutions",
    cmsKey: "opswatch.page.solutions",
    metaTitle: "Solutions",
    metaDescription:
      "OpsWatch solutions for operations teams, multi-app portfolios, and incident response.",
    hero: {
      eyebrow: "Solutions",
      title: "Operational clarity for teams that run many applications",
      subtitle:
        "OpsWatch helps platform and operations teams watch customer-facing applications, understand dependency impact and recover with policy controls.",
      primaryCta: { label: "Talk to us", href: "/contact" },
      secondaryCta: { label: "See the platform", href: "/platform" }
    },
    sections: [
      {
        id: "audiences",
        cmsKey: "opswatch.page.solutions.audiences",
        cards: [
          {
            id: "ops",
            title: "Operations teams",
            body: "Centralize health, alerts and incidents across applications. Use the Command Center as the daily workspace for triage and repair decisions."
          },
          {
            id: "portfolio",
            title: "Multi-application portfolios",
            body: "Register each application with its own monitors, topology and billing plan. Portfolio views show which products need attention without mixing tenancy."
          },
          {
            id: "incident",
            title: "Incident response",
            body: "Move from a failing check to correlated incident context, topology impact and a governed remediation path with verification after the change."
          },
          {
            id: "agency",
            title: "Agency and product studios",
            body: "Watch client sites and admin surfaces with agentless checks, then invite operators with role-based Command Center access."
          },
          {
            id: "reliability",
            title: "Reliability leads",
            body: "Combine check evidence, change events and automation outcomes to improve recovery discipline without claiming unfinished prediction features."
          },
          {
            id: "security",
            title: "Security-minded admins",
            body: "Keep credentials encrypted, sessions controlled and remediation behind policy while broader threat analytics continue to mature."
          }
        ]
      }
    ]
  },
  pricing: {
    slug: "pricing",
    cmsKey: "opswatch.page.pricing",
    metaTitle: "Pricing",
    metaDescription: "OpsWatch plans: Pilot, Growth, Business, and Enterprise. Billed per application.",
    hero: {
      eyebrow: "Pricing",
      title: "Straightforward plans. Billed per application.",
      subtitle:
        "Choose a plan for each application in the Command Center Billing tab. Stripe checkout and the customer portal are available when platform Stripe is connected.",
      primaryCta: { label: "Create account", href: "/register" },
      secondaryCta: { label: "Enterprise enquiry", href: "/contact?topic=enterprise" }
    },
    sections: [
      {
        id: "plans",
        cmsKey: "opswatch.page.pricing.plans",
        note: "After sign-in, open an application and use Billing to select Pilot, Growth, Business or a custom Enterprise arrangement. Workspace-wide subscriptions are not used. An optional Cloudflare backup add-on is not available yet and is not included in these prices."
      }
    ]
  },
  security: {
    slug: "security",
    cmsKey: "opswatch.page.security",
    metaTitle: "Security",
    metaDescription:
      "OpsWatch security controls for authentication, credentials, roles, audit, and governed remediation.",
    hero: {
      eyebrow: "Security",
      title: "Protect the control plane while operations stay honest",
      subtitle:
        "OpsWatch secures sign-in, secrets, roles and remediation boundaries. Broader threat detection analytics are foundation work and are not sold as a finished security operations centre.",
      primaryCta: { label: "Ask about security", href: "/contact" },
      secondaryCta: { label: "Review capabilities", href: "/features" }
    },
    sections: [
      {
        id: "controls",
        cmsKey: "opswatch.page.security.controls",
        cards: [
          {
            id: "auth",
            title: "Authentication and sessions",
            state: "Live",
            body: "HttpOnly session cookies, CSRF protection and session expiry protect Command Center access."
          },
          {
            id: "credentials",
            title: "Encrypted credentials",
            state: "Live",
            body: "Webhook, OpenTelemetry and connection secrets use managed encrypted storage with rotation paths."
          },
          {
            id: "roles",
            title: "Roles and membership",
            state: "Live",
            body: "Organization roles control who can administer projects, members, billing and automation policy."
          },
          {
            id: "remediation",
            title: "Governed remediation",
            state: "Live",
            body: "Approvals, auto-run policy, maintenance windows and registered executors bound what can run."
          },
          {
            id: "audit",
            title: "Audit and evidence",
            state: "Live",
            body: "Operational actions and security-relevant changes leave persisted evidence for review."
          },
          {
            id: "threat",
            title: "Threat analytics workspace",
            state: "Foundation",
            body: "Deterministic findings foundations exist. Do not treat the security workspace as complete SOC analytics."
          }
        ]
      }
    ]
  },
  about: {
    slug: "about",
    cmsKey: "opswatch.page.about",
    metaTitle: "About",
    metaDescription: "About OpsWatch, an Okang Group platform for application health and remediation.",
    hero: {
      eyebrow: "About OpsWatch",
      title: "Built for teams that need trustworthy operations software",
      subtitle:
        "OpsWatch is an Okang Group platform focused on agentless application health, topology-aware incidents and governed remediation. We prioritize verified capability over marketing theatre.",
      primaryCta: { label: "Contact us", href: "/contact" },
      secondaryCta: { label: "Explore the platform", href: "/platform" }
    },
    sections: [
      {
        id: "story",
        cmsKey: "opswatch.page.about.story",
        columns: 2,
        cards: [
          {
            id: "position",
            title: "Product position",
            body: "OpsWatch is an agentless application-health and incident-remediation platform with an advanced topology foundation. It is an independent OpsWatch product, not a frontend for third-party monitoring suites."
          },
          {
            id: "ship",
            title: "How we ship",
            body: "Features graduate through verified runtime evidence. Placeholders, seeded demos and unfinished connectors are labelled honestly on this website and inside the product."
          },
          {
            id: "audience",
            title: "Who it is for",
            body: "Operations teams, product studios and platform owners who need clear health across customer applications and a controlled path to repair."
          },
          {
            id: "okang",
            title: "Okang Group",
            body: "OpsWatch is developed within Okang Group alongside other production applications that rely on the same operational standards we expose to customers."
          }
        ]
      }
    ]
  },
  contact: {
    slug: "contact",
    cmsKey: "opswatch.page.contact",
    metaTitle: "Contact",
    metaDescription: "Contact OpsWatch for demos, Enterprise pricing, and onboarding questions.",
    hero: {
      eyebrow: "Contact",
      title: "Tell us what you need to monitor",
      subtitle:
        "Ask about demos, Enterprise pricing, security reviews or onboarding for your application portfolio. We respond by email."
    },
    sections: [
      {
        id: "guidance",
        cmsKey: "opswatch.page.contact.guidance",
        title: "What to include",
        body: "Share the applications you want to watch, whether you need agentless URL checks only, and if remediation providers are in scope. For Enterprise, include approximate application count and timeline.",
        note: "Existing customers can also sign in to the Command Center for billing and operational support questions tied to their workspace."
      }
    ]
  }
};

export const getMarketingPage = (slug: string): MarketingPageContent | null =>
  marketingPages[slug] ?? null;
