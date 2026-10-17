if (typeof window !== "undefined") {
  throw new Error("Server-only social provider imported by a browser module");
}

export {};
