/**
 * Registry definitions for the Mission 8 workforce tools. Claude's canonical
 * registry already declares repo.research/acquire/inspect/status; those are
 * skipped by the registrar so its newer definitions stay authoritative.
 */
import type { ToolDefinition } from "../tools/ToolRegistry";

const definitions: ToolDefinition[] = [
    {
      id: "kb.search",
      name: "Search Technology Knowledge",
      description:
        "Search LÉLU's technology knowledge base (researched repositories, capabilities, licences) " +
        "with the acquired fuzzy matcher. Tolerates typos.",
      category: "Knowledge",
      permissions: ["READ"],
      riskLevel: 0,
      available: true,
      executionRoute: "TechnologyKnowledgeBase.search",
      verificationMethod: "the returned entries come from the stored knowledge base",
    },
    {
      id: "kb.describe",
      name: "Technology Knowledge Report",
      description: "Report what LÉLU knows about repositories and which acquired capabilities are registered.",
      category: "Knowledge",
      permissions: ["READ"],
      riskLevel: 0,
      available: true,
      executionRoute: "TechnologyKnowledgeBase.describe",
    },
    {
      id: "repo.search",
      name: "Search Repositories",
      description:
        "Search public repositories (GitHub first) for a capability. Returns real metadata: stars, " +
        "licence, language, last push.",
      category: "Acquisition",
      permissions: ["READ", "EXTERNAL_ACTION"],
      riskLevel: 0,
      available: false,
      executionRoute: "RepoExecutive.discover",
      dependency: "acquisition runtime (/api/acquisition)",
    },
    {
      id: "repo.research",
      name: "Research Repository",
      description:
        "Research one repository for real: licence and obligations, maintenance, dependency and security " +
        "observations, compatibility with LÉLU, and capability signals.",
      category: "Acquisition",
      permissions: ["READ", "EXTERNAL_ACTION"],
      riskLevel: 0,
      available: false,
      executionRoute: "RepoExecutive.research",
      dependency: "acquisition runtime (/api/acquisition)",
    },
    {
      id: "repo.acquire",
      name: "Acquire Repository",
      description:
        "Clone a public repository into an isolated acquisition workspace with its own git history. " +
        "Nothing is installed or executed by this step.",
      category: "Acquisition",
      permissions: ["EXECUTE", "EXTERNAL_ACTION"],
      riskLevel: 2,
      available: false,
      executionRoute: "AcquisitionRuntime.clone",
      dependency: "acquisition runtime (/api/acquisition)",
      verificationMethod: "server returns the cloned commit, file count and detected licence",
    },
    {
      id: "repo.inspect",
      name: "Inspect Acquisition",
      description:
        "List or read files inside an acquired repository. Credential files are refused by the runtime.",
      category: "Acquisition",
      permissions: ["READ"],
      riskLevel: 0,
      available: false,
      executionRoute: "AcquisitionRuntime.tree / read",
      dependency: "acquisition runtime (/api/acquisition)",
    },
    {
      id: "repo.exec",
      name: "Run In Acquisition",
      description:
        "Run the acquired repository's install, test, build or typecheck command in its isolated " +
        "workspace, with a scrubbed environment and a real exit code.",
      category: "Acquisition",
      permissions: ["EXECUTE"],
      riskLevel: 3,
      available: false,
      executionRoute: "AcquisitionRuntime.exec",
      dependency: "acquisition runtime (/api/acquisition)",
    },
    {
      id: "repo.commit",
      name: "Commit Acquisition",
      description:
        "Commit the adaptation inside the acquisition to an authorized branch. Requires an explicit " +
        "approval from a named operator and a server-issued grant.",
      category: "Acquisition",
      permissions: ["WRITE"],
      riskLevel: 3,
      available: false,
      executionRoute: "AcquisitionRuntime.commit",
      dependency: "acquisition runtime + approval",
    },
    {
      id: "repo.rollback",
      name: "Roll Back Acquisition",
      description:
        "Reset an acquisition to a recorded version. Destructive: requires a named operator approval.",
      category: "Acquisition",
      permissions: ["WRITE", "DESTRUCTIVE"],
      riskLevel: 4,
      available: false,
      executionRoute: "AcquisitionRuntime.rollback",
      dependency: "acquisition runtime + approval",
    },
    {
      id: "memory.cache",
      name: "Bounded Working Cache",
      description:
        "LÉLU's bounded LRU working cache, acquired from quick-lru: put/get/stats, expiry and eviction, " +
        "with a behavioural self-test.",
      category: "Knowledge",
      permissions: ["READ", "WRITE"],
      riskLevel: 1,
      available: true,
      executionRoute: "BoundedCache",
      verificationMethod: "selftest exercises insert, read, expiry and LRU eviction",
    },
    {
      id: "capabilities.list",
      name: "List Acquired Capabilities",
      description:
        "List the acquired-capability marketplace: provenance, licence, dependencies, registered tools, " +
        "activation state and available updates.",
      category: "Acquisition",
      permissions: ["READ"],
      riskLevel: 0,
      available: true,
      executionRoute: "CapabilityMarketplace.inventory",
    },
    {
      id: "capabilities.activate",
      name: "Activate Capability",
      description: "Switch an acquired capability on. Its registered tools are offered again.",
      category: "Acquisition",
      permissions: ["WRITE"],
      riskLevel: 1,
      available: true,
      executionRoute: "CapabilityMarketplace.activate",
    },
    {
      id: "capabilities.deactivate",
      name: "Deactivate Capability",
      description:
        "Switch an acquired capability off. Its registered tools stop being offered and the dispatcher refuses them.",
      category: "Acquisition",
      permissions: ["WRITE"],
      riskLevel: 1,
      available: true,
      executionRoute: "CapabilityMarketplace.deactivate",
    },
    {
      id: "capabilities.remove",
      name: "Remove Capability Integration",
      description:
        "Remove an acquired capability from LÉLU's registries. Destructive and reversible only by restore; " +
        "requires a named operator approval.",
      category: "Acquisition",
      permissions: ["WRITE", "DESTRUCTIVE"],
      riskLevel: 4,
      available: true,
      executionRoute: "CapabilityMarketplace.remove",
      dependency: "destructive approval",
    },
    {
      id: "repo.pipeline",
      name: "Acquire And Integrate Capability",
      description:
        "Run the full repository-to-capability pipeline for an objective: discover, research, acquire, " +
        "adapt, connect, test, commit, register and use. Requires a named approver.",
      category: "Acquisition",
      permissions: ["EXECUTE", "WRITE", "EXTERNAL_ACTION"],
      riskLevel: 3,
      available: false,
      executionRoute: "EngineeringCommandCenter.prepare/execute",
      dependency: "acquisition runtime + approval",
    },
    {
      id: "repo.maintenance",
      name: "Maintain Acquisition Workspace",
      description:
        "Verify acquisition integrity, recover interrupted acquisitions, or clean experimental ones under " +
        "the storage policy. Cleanup is destructive and requires a named approval.",
      category: "Acquisition",
      permissions: ["READ", "WRITE", "DESTRUCTIVE"],
      riskLevel: 3,
      available: false,
      executionRoute: "AcquisitionRuntime.maintenance",
      dependency: "acquisition runtime",
    },
    {
      id: "creator.build",
      name: "Build Creator Project",
      description:
        "Turn a stated objective into a real project scaffold, written through the engineering workspace " +
        "runtime and validated by its real typecheck.",
      category: "Acquisition",
      permissions: ["WRITE"],
      riskLevel: 2,
      available: true,
      executionRoute: "CreatorStudio.plan/create",
      dependency: "engineering runtime (/api/engineer)",
    },
  ];

export default definitions;
