import { runFilterEngine } from "../filter-engine.ts";
import type { InformationProvider } from "../types.ts";

export const demoProvider: InformationProvider = {
  id: "demo",
  label: "DemoProvider",
  getStatus: () => "available",
  async run(context) {
    return runFilterEngine(context);
  },
};
