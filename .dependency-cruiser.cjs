/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Circular dependencies make module initialization and change impact unpredictable. Type-only cycles are erased at runtime and allowed.",
      from: {},
      to: { circular: true, dependencyTypesNot: ["type-only"] },
    },
    {
      name: "no-production-to-tests",
      severity: "error",
      from: { pathNot: "^tests/" },
      to: { path: "^tests/" },
    },
    {
      name: "no-core-to-app",
      severity: "error",
      comment: "Domain and provider layers must not depend on the application entry layer.",
      from: { path: "^(information|research|social|lib|components)/" },
      to: { path: "^app/" },
    },
    {
      name: "no-social-upward-dependencies",
      severity: "error",
      comment: "The social provider layer stays below research, information, and UI layers.",
      from: { path: "^social/" },
      to: { path: "^(app|components|information|research)/" },
    },
    {
      name: "no-research-to-ui",
      severity: "error",
      from: { path: "^research/" },
      to: { path: "^(app|components)/" },
    },
    {
      name: "no-information-to-ui",
      severity: "error",
      from: { path: "^information/" },
      to: { path: "^(app|components)/" },
    },
    {
      name: "no-backend-to-ui",
      severity: "error",
      from: { path: "^backend/" },
      to: { path: "^(app|components)/" },
    },
    {
      name: "no-app-to-social-implementations",
      severity: "error",
      comment: "UI imports the social access contract, not concrete providers or adapters.",
      from: { path: "^app/" },
      to: { path: "^social/(providers/(x|xiaohongshu)|connections)/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(node_modules|dist|\\.next|\\.vinext|\\.wrangler|\\.agents)(/|$)" },
    tsConfig: { fileName: "./tsconfig.json" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: { exportsFields: ["exports"], conditionNames: ["import", "require", "node", "default"] },
  },
};
